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

const headersFor = session => ({
  cookie: `${sessionCookieName}=${session.token}`,
  'x-csrf-token': session.csrfToken
});

const tokenFromEmail = message => {
  const match = message.text.match(/redefinir-senha\.html#token=([A-Za-z0-9_-]{40,128})/);
  assert.ok(match, 'O e-mail deve conter um token de recuperação no fragmento da URL.');
  return match[1];
};

test('recuperação de senha é neutra, única, expira e revoga sessões de qualquer papel', { skip: !enabled }, async () => {
  const config = {
    ...loadConfig(),
    frontendUrl: 'https://sevgestaoesistemas.github.io/sistema-SEV',
    passwordResetTtlMinutes: 30
  };
  assert.ok(config.databaseUrl, 'DATABASE_URL is required for the password reset integration test.');

  const database = createDatabase(config);
  const deliveries = [];
  const emailSender = async message => { deliveries.push(message); };
  let app;
  let fixture;
  try {
    fixture = await database.transaction(async transaction => {
      const organization = await transaction.query(
        'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
        ['Password Reset Company', `password-reset-${randomUUID()}`]
      );
      const passwordHash = await hashPassword('TemporaryTestPassword2026');
      const operator = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email',
        ['Password Reset Operator', `password-reset-operator-${randomUUID()}@test.invalid`, passwordHash]
      );
      const finance = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email',
        ['Password Reset Finance', `password-reset-finance-${randomUUID()}@test.invalid`, passwordHash]
      );
      await transaction.query(
        `INSERT INTO organization_memberships (organization_id, user_id, role)
         VALUES ($1, $2, 'operator'), ($1, $3, 'finance')`,
        [organization.rows[0].id, operator.rows[0].id, finance.rows[0].id]
      );
      const firstSession = await createStoredSession(transaction, {
        userId: operator.rows[0].id,
        organizationId: organization.rows[0].id,
        config
      });
      const secondSession = await createStoredSession(transaction, {
        userId: operator.rows[0].id,
        organizationId: organization.rows[0].id,
        config
      });
      return {
        organizationId: organization.rows[0].id,
        userIds: [operator.rows[0].id, finance.rows[0].id],
        operator: operator.rows[0],
        finance: finance.rows[0],
        firstSession,
        secondSession
      };
    });

    app = await buildApp({ config: { ...config, environment: 'test' }, db: database, emailSender, logger: false });

    const missingAccount = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      payload: { email: `missing-${randomUUID()}@test.invalid` }
    });
    assert.equal(missingAccount.statusCode, 200);
    assert.deepEqual(missingAccount.json(), { accepted: true });
    assert.equal(deliveries.length, 0);

    const operatorRequest = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      payload: { email: fixture.operator.email }
    });
    assert.equal(operatorRequest.statusCode, 200);
    assert.deepEqual(operatorRequest.json(), missingAccount.json());
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].to, fixture.operator.email);
    const operatorToken = tokenFromEmail(deliveries[0]);

    const storedToken = await database.query(
      'SELECT token_hash FROM password_reset_tokens WHERE user_id = $1',
      [fixture.userIds[0]]
    );
    assert.equal(storedToken.rowCount, 1);
    assert.notEqual(storedToken.rows[0].token_hash, operatorToken);

    const financeRequest = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      payload: { email: fixture.finance.email }
    });
    assert.equal(financeRequest.statusCode, 200);
    const financeToken = tokenFromEmail(deliveries[1]);
    await database.query(
      `UPDATE password_reset_tokens
          SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
        WHERE user_id = $1`,
      [fixture.userIds[1]]
    );
    const expired = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset/confirm',
      payload: { token: financeToken, newPassword: 'NewSecurePassword2026' }
    });
    assert.equal(expired.statusCode, 400);
    assert.equal(expired.json().error.code, 'INVALID_PASSWORD_RESET_TOKEN');

    const completed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset/confirm',
      payload: { token: operatorToken, newPassword: 'NewSecurePassword2026' }
    });
    assert.equal(completed.statusCode, 200);
    assert.deepEqual(completed.json(), { updated: true });
    assert.equal(completed.headers['set-cookie'], undefined);

    for (const session of [fixture.firstSession, fixture.secondSession]) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: headersFor(session)
      });
      assert.equal(response.statusCode, 401);
    }

    const reusedToken = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset/confirm',
      payload: { token: operatorToken, newPassword: 'AnotherSecurePassword2026' }
    });
    assert.equal(reusedToken.statusCode, 400);
    assert.equal(reusedToken.json().error.code, 'INVALID_PASSWORD_RESET_TOKEN');

    const previousPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: fixture.operator.email, password: 'TemporaryTestPassword2026' }
    });
    assert.equal(previousPassword.statusCode, 401);
    assert.equal(previousPassword.json().error.code, 'INVALID_CREDENTIALS');

    const newPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: fixture.operator.email, password: 'NewSecurePassword2026' }
    });
    assert.equal(newPassword.statusCode, 200);
    assert.equal(newPassword.json().user.organization.role, 'operator');
  } finally {
    if (fixture) {
      await database.transaction(async transaction => {
        await transaction.query('DELETE FROM organizations WHERE id = $1', [fixture.organizationId]);
        await transaction.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [fixture.userIds]);
      });
    }
    await app?.close();
    if (!app) await database.close();
  }
});
