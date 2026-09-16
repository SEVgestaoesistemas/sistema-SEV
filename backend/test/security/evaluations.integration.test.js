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
const createOrganization = async (database, name) => (await database.query(
  'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id', [name, `evaluations-${randomUUID()}`]
)).rows[0].id;
const activateEvaluations = (database, organizationId) => database.query(
  `UPDATE empresa_modulos vinculo SET ativo = true, ativado_em = now()
    FROM modulos modulo
   WHERE vinculo.organization_id = $1 AND vinculo.modulo_id = modulo.id AND modulo.slug = 'avaliacoes'`, [organizationId]
);

test('avaliações calculam a nota no servidor, ocultam gabarito para colaborador e preservam isolamento', { skip: !enabled }, async () => {
  const config = loadConfig();
  assert.ok(config.databaseUrl, 'DATABASE_URL is required for the evaluations security test.');
  const database = createDatabase(config);
  let app;
  let fixture;
  try {
    fixture = await database.transaction(async transaction => {
      const organizationA = await createOrganization(transaction, 'Evaluations Company A');
      const organizationB = await createOrganization(transaction, 'Evaluations Company B');
      const passwordHash = await hashPassword('TemporaryTestPassword2026!');
      const ownerA = await transaction.query('INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id', ['Evaluation Owner A', `evaluations-owner-a-${randomUUID()}@test.invalid`, passwordHash]);
      const operatorA = await transaction.query('INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id', ['Evaluation Operator A', `evaluations-operator-a-${randomUUID()}@test.invalid`, passwordHash]);
      const ownerB = await transaction.query('INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id', ['Evaluation Owner B', `evaluations-owner-b-${randomUUID()}@test.invalid`, passwordHash]);
      await transaction.query(
        "INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'operator'), ($4, $5, 'owner')",
        [organizationA, ownerA.rows[0].id, operatorA.rows[0].id, organizationB, ownerB.rows[0].id]
      );
      const ownerSession = await createStoredSession(transaction, { userId: ownerA.rows[0].id, organizationId: organizationA, config });
      const operatorSession = await createStoredSession(transaction, { userId: operatorA.rows[0].id, organizationId: organizationA, config });
      const foreignSession = await createStoredSession(transaction, { userId: ownerB.rows[0].id, organizationId: organizationB, config });
      return { organizationA, organizationB, userIds: [ownerA.rows[0].id, operatorA.rows[0].id, ownerB.rows[0].id], ownerSession, operatorSession, foreignSession };
    });
    app = await buildApp({ config: { ...config, environment: 'test' }, db: database, logger: false });
    const ownerHeaders = { cookie: `${sessionCookieName}=${fixture.ownerSession.token}`, 'x-csrf-token': fixture.ownerSession.csrfToken };
    const operatorHeaders = { cookie: `${sessionCookieName}=${fixture.operatorSession.token}`, 'x-csrf-token': fixture.operatorSession.csrfToken };
    const foreignHeaders = { cookie: `${sessionCookieName}=${fixture.foreignSession.token}`, 'x-csrf-token': fixture.foreignSession.csrfToken };

    const unavailable = await app.inject({ method: 'GET', url: '/api/v1/avaliacoes', headers: ownerHeaders });
    assert.equal(unavailable.statusCode, 403);
    assert.equal(unavailable.json().error.code, 'MODULE_NOT_ACTIVE');
    await activateEvaluations(database, fixture.organizationA);

    const creation = await app.inject({
      method: 'POST', url: '/api/v1/avaliacoes', headers: ownerHeaders,
      payload: { titulo: 'Boas práticas', notaMinima: 60, questoes: [
        { enunciado: 'Qual opção é segura?', opcoes: [{ texto: 'A correta', correta: true }, { texto: 'Incorreta', correta: false }] },
        { enunciado: 'Qual opção deve ser evitada?', opcoes: [{ texto: 'Incorreta', correta: false }, { texto: 'A correta', correta: true }] }
      ] }
    });
    assert.equal(creation.statusCode, 201);
    const evaluation = creation.json().evaluation;
    assert.equal(evaluation.questions[0].options[0].correct, true);

    const operatorList = await app.inject({ method: 'GET', url: '/api/v1/avaliacoes', headers: operatorHeaders });
    assert.equal(operatorList.statusCode, 200);
    assert.equal(Object.hasOwn(operatorList.json().evaluations[0].questions[0].options[0], 'correct'), false);

    const operatorEvaluation = operatorList.json().evaluations[0];
    const attempt = await app.inject({
      method: 'POST', url: `/api/v1/avaliacoes/${evaluation.id}/tentativas`, headers: operatorHeaders,
      payload: { respostas: [
        { questaoId: operatorEvaluation.questions[0].id, opcaoId: operatorEvaluation.questions[0].options[0].id },
        { questaoId: operatorEvaluation.questions[1].id, opcaoId: operatorEvaluation.questions[1].options[0].id }
      ] }
    });
    assert.equal(attempt.statusCode, 201);
    assert.equal(attempt.json().attempt.scorePercent, 50);
    assert.equal(attempt.json().attempt.approved, false);
    assert.equal(attempt.json().answerKey.filter(answer => answer.correct).length, 1);

    const results = await app.inject({ method: 'GET', url: `/api/v1/avaliacoes/${evaluation.id}/tentativas`, headers: ownerHeaders });
    assert.equal(results.statusCode, 200);
    assert.equal(results.json().attempts.length, 1);
    const operatorCannotReadResults = await app.inject({ method: 'GET', url: `/api/v1/avaliacoes/${evaluation.id}/tentativas`, headers: operatorHeaders });
    assert.equal(operatorCannotReadResults.statusCode, 403);
    const foreignModule = await app.inject({ method: 'GET', url: `/api/v1/avaliacoes/${evaluation.id}/tentativas`, headers: foreignHeaders });
    assert.equal(foreignModule.statusCode, 403);

    const tenantB = database.forTenant({ organizationId: fixture.organizationB, userId: fixture.userIds[2] });
    const hidden = await tenantB.query('SELECT id FROM avaliacoes WHERE id = $1', [evaluation.id]);
    assert.equal(hidden.rowCount, 0, 'RLS must hide assessments from another organization');
    const update = await tenantB.query('UPDATE avaliacoes SET titulo = titulo WHERE id = $1', [evaluation.id]);
    assert.equal(update.rowCount, 0, 'RLS must prevent cross-organization assessment updates');
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
