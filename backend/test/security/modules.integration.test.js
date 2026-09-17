import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../src/config.js';
import { createDatabase } from '../../src/db/database.js';
import { buildApp } from '../../src/app.js';
import { createStoredSession } from '../../src/auth/service.js';
import { requireModule } from '../../src/auth/middleware.js';
import { hashPassword } from '../../src/security/password.js';
import { sessionCookieName } from '../../src/security/session.js';

const enabled = process.env.RUN_DATABASE_SECURITY_TESTS === 'true';

const createOrganization = async (database, name) => {
  const result = await database.query(
    'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
    [name, `modules-${randomUUID()}`]
  );
  return result.rows[0].id;
};

test('módulos contratados são isolados por empresa, exigem administração da plataforma e iniciam Gestão ativa', { skip: !enabled }, async () => {
  const config = loadConfig();
  assert.ok(config.databaseUrl, 'DATABASE_URL is required for the modules security test.');
  const database = createDatabase(config);
  let app;
  let fixture;
  try {
    fixture = await database.transaction(async transaction => {
      const organizationA = await createOrganization(transaction, 'Modules Platform Company');
      const organizationB = await createOrganization(transaction, 'Modules Customer Company');
      const passwordHash = await hashPassword('TemporaryTestPassword2026!');
      const userA = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        ['Modules Platform Admin', `modules-platform-${randomUUID()}@test.invalid`, passwordHash]
      );
      const userB = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        ['Modules Customer Owner', `modules-customer-${randomUUID()}@test.invalid`, passwordHash]
      );
      await transaction.query(
        "INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'owner')",
        [organizationA, userA.rows[0].id, organizationB, userB.rows[0].id]
      );
      await transaction.query('INSERT INTO platform_administrators (user_id) VALUES ($1)', [userA.rows[0].id]);
      const sessionA = await createStoredSession(transaction, {
        userId: userA.rows[0].id,
        organizationId: organizationA,
        config
      });
      const sessionB = await createStoredSession(transaction, {
        userId: userB.rows[0].id,
        organizationId: organizationB,
        config
      });
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
    app = await buildApp({ config: { ...config, environment: 'test' }, db: database, logger: false });
    const platformHeaders = {
      cookie: `${sessionCookieName}=${fixture.sessionA.token}`,
      'x-csrf-token': fixture.sessionA.csrfToken
    };
    const customerHeaders = {
      cookie: `${sessionCookieName}=${fixture.sessionB.token}`,
      'x-csrf-token': fixture.sessionB.csrfToken
    };

    const customerBeforeActivation = await app.inject({
      method: 'GET', url: '/api/v1/empresa/modulos', headers: customerHeaders
    });
    assert.equal(customerBeforeActivation.statusCode, 200);
    assert.deepEqual(customerBeforeActivation.json().modules.map(module => module.slug), ['gestao']);

    const catalog = await app.inject({
      method: 'GET', url: `/api/v1/platform/companies/${fixture.organizationB}/modules`, headers: platformHeaders
    });
    assert.equal(catalog.statusCode, 200);
    assert.deepEqual(catalog.json().modules.map(module => [module.slug, module.active]), [
      ['gestao', true], ['crm', false]
    ]);
    const crm = catalog.json().modules.find(module => module.slug === 'crm');

    const forbiddenAdministration = await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/companies/${fixture.organizationB}/modules/${crm.id}`,
      headers: customerHeaders,
      payload: { active: true }
    });
    assert.equal(forbiddenAdministration.statusCode, 403);
    assert.equal(forbiddenAdministration.json().error.code, 'PLATFORM_ADMIN_REQUIRED');

    const activation = await app.inject({
      method: 'PATCH',
      url: `/api/v1/platform/companies/${fixture.organizationB}/modules/${crm.id}`,
      headers: platformHeaders,
      payload: { active: true }
    });
    assert.equal(activation.statusCode, 200);
    assert.equal(activation.json().module.slug, 'crm');
    assert.equal(activation.json().module.active, true);
    assert.ok(activation.json().module.activatedAt);

    const customerAfterActivation = await app.inject({
      method: 'GET', url: '/api/v1/empresa/modulos', headers: customerHeaders
    });
    assert.equal(customerAfterActivation.statusCode, 200);
    assert.deepEqual(customerAfterActivation.json().modules.map(module => module.slug), ['gestao', 'crm']);

    const tenantA = database.forTenant({ organizationId: fixture.organizationA, userId: fixture.userAId });
    const tenantB = database.forTenant({ organizationId: fixture.organizationB, userId: fixture.userBId });
    const invisibleForeignModules = await tenantA.query(
      'SELECT id FROM empresa_modulos WHERE organization_id = $1', [fixture.organizationB]
    );
    assert.equal(invisibleForeignModules.rowCount, 0, 'RLS must hide another company module assignments');
    await assert.rejects(
      tenantA.query('UPDATE empresa_modulos SET ativo = true WHERE organization_id = $1 AND modulo_id = $2', [fixture.organizationB, crm.id]),
      error => error.code === '42501'
    );
    await assert.rejects(
      requireModule('crm')({ tenantDb: tenantA }),
      error => error.code === 'MODULE_NOT_ACTIVE' && error.statusCode === 403
    );
    await requireModule('crm')({ tenantDb: tenantB });

    const organizationC = await createOrganization(database, 'Modules New Company');
    fixture.organizationC = organizationC;
    const defaultModules = await database.query(
      `SELECT modulo.slug, vinculo.ativo
         FROM empresa_modulos vinculo
         JOIN modulos modulo ON modulo.id = vinculo.modulo_id
        WHERE vinculo.organization_id = $1
        ORDER BY CASE modulo.slug WHEN 'gestao' THEN 0 WHEN 'crm' THEN 1 ELSE 2 END`,
      [organizationC]
    );
    assert.deepEqual(defaultModules.rows.map(row => [row.slug, row.ativo]), [
      ['gestao', true], ['crm', false]
    ]);
  } finally {
    if (fixture) {
      await database.transaction(async transaction => {
        const organizations = [fixture.organizationA, fixture.organizationB, fixture.organizationC].filter(Boolean);
        await transaction.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [organizations]);
        await transaction.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [fixture.userIds]);
      });
    }
    await app?.close();
    if (!app) await database.close();
  }
});
