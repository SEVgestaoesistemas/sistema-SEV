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
  'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id', [name, `crm-${randomUUID()}`]
)).rows[0].id;
const activateCrm = (database, organizationId) => database.query(
  `UPDATE empresa_modulos vinculo SET ativo = true, ativado_em = now()
    FROM modulos modulo
   WHERE vinculo.organization_id = $1 AND vinculo.modulo_id = modulo.id AND modulo.slug = 'crm'`, [organizationId]
);

test('CRM exige módulo ativo, cria funil padrão, grava histórico e isola negociações no RLS', { skip: !enabled }, async () => {
  const config = loadConfig();
  assert.ok(config.databaseUrl, 'DATABASE_URL is required for the CRM security test.');
  const database = createDatabase(config);
  let app;
  let fixture;
  try {
    fixture = await database.transaction(async transaction => {
      const organizationA = await createOrganization(transaction, 'CRM Company A');
      const organizationB = await createOrganization(transaction, 'CRM Company B');
      const passwordHash = await hashPassword('TemporaryTestPassword2026!');
      const ownerA = await transaction.query('INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id', ['CRM Owner A', `crm-owner-a-${randomUUID()}@test.invalid`, passwordHash]);
      const operatorA = await transaction.query('INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id', ['CRM Operator A', `crm-operator-a-${randomUUID()}@test.invalid`, passwordHash]);
      const ownerB = await transaction.query('INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id', ['CRM Owner B', `crm-owner-b-${randomUUID()}@test.invalid`, passwordHash]);
      await transaction.query("INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'operator'), ($4, $5, 'owner')", [organizationA, ownerA.rows[0].id, operatorA.rows[0].id, organizationB, ownerB.rows[0].id]);
      return {
        organizationA, organizationB, userIds: [ownerA.rows[0].id, operatorA.rows[0].id, ownerB.rows[0].id],
        ownerSession: await createStoredSession(transaction, { userId: ownerA.rows[0].id, organizationId: organizationA, config }),
        operatorSession: await createStoredSession(transaction, { userId: operatorA.rows[0].id, organizationId: organizationA, config }),
        foreignSession: await createStoredSession(transaction, { userId: ownerB.rows[0].id, organizationId: organizationB, config })
      };
    });
    app = await buildApp({ config: { ...config, environment: 'test' }, db: database, logger: false });
    const ownerHeaders = { cookie: `${sessionCookieName}=${fixture.ownerSession.token}`, 'x-csrf-token': fixture.ownerSession.csrfToken };
    const operatorHeaders = { cookie: `${sessionCookieName}=${fixture.operatorSession.token}`, 'x-csrf-token': fixture.operatorSession.csrfToken };
    const foreignHeaders = { cookie: `${sessionCookieName}=${fixture.foreignSession.token}`, 'x-csrf-token': fixture.foreignSession.csrfToken };

    const inactive = await app.inject({ method: 'GET', url: '/api/v1/crm/etapas', headers: ownerHeaders });
    assert.equal(inactive.statusCode, 403);
    assert.equal(inactive.json().error.code, 'MODULE_NOT_ACTIVE');
    await activateCrm(database, fixture.organizationA);
    const stagesResponse = await app.inject({ method: 'GET', url: '/api/v1/crm/etapas', headers: ownerHeaders });
    assert.equal(stagesResponse.statusCode, 200);
    assert.equal(stagesResponse.json().stages.length, 6);
    const [firstStage, secondStage] = stagesResponse.json().stages;

    const creation = await app.inject({ method: 'POST', url: '/api/v1/crm/negociacoes', headers: operatorHeaders, payload: { etapaId: firstStage.id, nome: 'Implantação teste', valorCents: 125000, fonte: 'Indicação' } });
    assert.equal(creation.statusCode, 201);
    const dealId = creation.json().negotiation.id;
    const task = await app.inject({ method: 'POST', url: `/api/v1/crm/negociacoes/${dealId}/tarefas`, headers: operatorHeaders, payload: { texto: 'Agendar reunião', prazo: '2026-12-01' } });
    assert.equal(task.statusCode, 201);
    const moved = await app.inject({ method: 'PATCH', url: `/api/v1/crm/negociacoes/${dealId}/etapa`, headers: operatorHeaders, payload: { etapaId: secondStage.id } });
    assert.equal(moved.statusCode, 200);
    assert.equal(moved.json().negotiation.stage.id, secondStage.id);
    assert.ok(moved.json().negotiation.history.some(item => item.type === 'mudanca_etapa'));
    const completed = await app.inject({ method: 'PATCH', url: `/api/v1/crm/tarefas/${task.json().task.id}`, headers: operatorHeaders, payload: { feita: true } });
    assert.equal(completed.statusCode, 200);

    const grouped = await app.inject({ method: 'GET', url: '/api/v1/crm/negociacoes?agrupado_por_etapa=true', headers: ownerHeaders });
    assert.equal(grouped.statusCode, 200);
    assert.equal(grouped.json().stages.find(stage => stage.id === secondStage.id).negotiations[0].id, dealId);
    const foreign = await app.inject({ method: 'GET', url: `/api/v1/crm/negociacoes/${dealId}`, headers: foreignHeaders });
    assert.equal(foreign.statusCode, 403);

    const tenantB = database.forTenant({ organizationId: fixture.organizationB, userId: fixture.userIds[2] });
    const hidden = await tenantB.query('SELECT id FROM crm_negociacoes WHERE id = $1', [dealId]);
    assert.equal(hidden.rowCount, 0, 'RLS must hide negotiations from another company');
    const update = await tenantB.query('UPDATE crm_negociacoes SET nome = nome WHERE id = $1', [dealId]);
    assert.equal(update.rowCount, 0, 'RLS must prevent cross-company negotiation updates');
  } finally {
    if (fixture) await database.transaction(async transaction => {
      await transaction.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[fixture.organizationA, fixture.organizationB]]);
      await transaction.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [fixture.userIds]);
    });
    await app?.close();
    if (!app) await database.close();
  }
});
