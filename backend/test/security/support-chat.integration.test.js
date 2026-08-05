import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../src/config.js';
import { createDatabase } from '../../src/db/database.js';
import { buildApp } from '../../src/app.js';
import { createStoredSession } from '../../src/auth/service.js';
import { hashPassword } from '../../src/security/password.js';
import { sessionCookieName } from '../../src/security/session.js';

const enabled = process.env.RUN_DATABASE_SECURITY_TESTS === 'true';

const insertOrganization = async (client, name) => {
  const result = await client.query(
    'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
    [name, `support-${randomUUID()}`]
  );
  return result.rows[0].id;
};

test('chat de suporte é limitado e isolado por organização no RLS', { skip: !enabled }, async () => {
  const config = loadConfig();
  assert.ok(config.databaseUrl, 'DATABASE_URL is required for the support integration test.');

  const database = createDatabase(config);
  let app;
  let fixture;
  try {
    fixture = await database.transaction(async transaction => {
      const organizationA = await insertOrganization(transaction, 'Support Company A');
      const organizationB = await insertOrganization(transaction, 'Support Company B');
      const passwordHash = await hashPassword('TemporaryTestPassword2026');
      const userA = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        ['Support User A', `support-a-${randomUUID()}@test.invalid`, passwordHash]
      );
      const userB = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        ['Support User B', `support-b-${randomUUID()}@test.invalid`, passwordHash]
      );
      await transaction.query(
        "INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'owner')",
        [organizationA, userA.rows[0].id, organizationB, userB.rows[0].id]
      );
      const sessionA = await createStoredSession(transaction, { userId: userA.rows[0].id, organizationId: organizationA, config });
      const sessionB = await createStoredSession(transaction, { userId: userB.rows[0].id, organizationId: organizationB, config });
      return {
        organizationA,
        organizationB,
        userAId: userA.rows[0].id,
        userBId: userB.rows[0].id,
        userIds: [userA.rows[0].id, userB.rows[0].id],
        sessionA,
        sessionB
      };
    });

    const askedQuestions = [];
    const fakeGeminiChat = async question => {
      askedQuestions.push(question);
      if (question.includes('piada')) return { inScope: false, needsHuman: false, answer: 'Não use esta resposta.' };
      return { inScope: true, needsHuman: false, answer: 'Use o menu Estoque para cadastrar o produto.' };
    };
    fakeGeminiChat.isConfigured = true;
    app = await buildApp({
      config: {
        ...config,
        environment: 'test',
        supportChatUserDailyLimit: 1,
        supportChatOrganizationDailyLimit: 5
      },
      db: database,
      geminiChat: fakeGeminiChat,
      logger: false
    });
    const headersA = {
      cookie: `${sessionCookieName}=${fixture.sessionA.token}`,
      'x-csrf-token': fixture.sessionA.csrfToken
    };
    const headersB = {
      cookie: `${sessionCookieName}=${fixture.sessionB.token}`,
      'x-csrf-token': fixture.sessionB.csrfToken
    };

    const ownQuestion = await app.inject({
      method: 'POST', url: '/api/v1/support/chat', headers: headersA, payload: { message: 'Como cadastro um produto?' }
    });
    assert.equal(ownQuestion.statusCode, 200);
    assert.equal(ownQuestion.json().answer, 'Use o menu Estoque para cadastrar o produto.');
    assert.equal(ownQuestion.json().needsHuman, false);
    assert.equal(ownQuestion.json().usage.userRemaining, 0);

    const offScopeQuestion = await app.inject({
      method: 'POST', url: '/api/v1/support/chat', headers: headersB, payload: { message: 'Conte uma piada' }
    });
    assert.equal(offScopeQuestion.statusCode, 200);
    assert.match(offScopeQuestion.json().answer, /somente com o uso do sistema SEV/i);
    assert.equal(offScopeQuestion.json().needsHuman, true);
    assert.deepEqual(askedQuestions, ['Como cadastro um produto?', 'Conte uma piada']);

    const limited = await app.inject({
      method: 'POST', url: '/api/v1/support/chat', headers: headersA, payload: { message: 'Como crio uma venda?' }
    });
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().error.code, 'SUPPORT_USER_RATE_LIMIT');

    const tenantA = database.forTenant({ organizationId: fixture.organizationA, userId: fixture.userAId });
    const hiddenForeignUsage = await tenantA.query(
      'SELECT user_id FROM support_chat_usage WHERE organization_id = $1',
      [fixture.organizationB]
    );
    assert.equal(hiddenForeignUsage.rowCount, 0);
    await assert.rejects(
      tenantA.query(
        "INSERT INTO support_chat_usage (organization_id, user_id, usage_date, request_count) VALUES ($1, $2, CURRENT_DATE, 1)",
        [fixture.organizationB, fixture.userBId]
      ),
      error => error.code === '42501'
    );
  } finally {
    if (fixture) {
      await database.transaction(async transaction => {
        await transaction.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[fixture.organizationA, fixture.organizationB]]);
        await transaction.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [fixture.userIds]);
      });
    }
    await app?.close();
    if (!app) await database.close();
  }
});
