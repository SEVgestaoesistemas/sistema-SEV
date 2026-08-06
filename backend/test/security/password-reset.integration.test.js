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

const cookieFrom = response => {
  const value = response.headers['set-cookie'];
  return (Array.isArray(value) ? value[0] : value).split(';')[0];
};

test('administrador da plataforma cria senha provisória de uso obrigatório, expira e só alcança usuário da empresa', { skip: !enabled }, async () => {
  const config = { ...loadConfig(), environment: 'test' };
  assert.ok(config.databaseUrl, 'DATABASE_URL is required for the temporary password integration test.');

  const database = createDatabase(config);
  let app;
  let fixture;
  try {
    fixture = await database.transaction(async transaction => {
      const companyA = await transaction.query(
        'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
        ['Temporary Password Company A', `temporary-password-a-${randomUUID()}`]
      );
      const companyB = await transaction.query(
        'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
        ['Temporary Password Company B', `temporary-password-b-${randomUUID()}`]
      );
      const platformPasswordHash = await hashPassword('PlatformPassword2026!');
      const customerPasswordHash = await hashPassword('CustomerPassword2026!');
      const platformAdmin = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email',
        ['Platform Administrator', `platform-admin-${randomUUID()}@test.invalid`, platformPasswordHash]
      );
      const customer = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email',
        ['Customer Operator', `customer-operator-${randomUUID()}@test.invalid`, customerPasswordHash]
      );
      const otherCompanyUser = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        ['Other Company User', `other-company-${randomUUID()}@test.invalid`, customerPasswordHash]
      );
      await transaction.query(
        `INSERT INTO organization_memberships (organization_id, user_id, role)
         VALUES ($1, $2, 'owner'), ($1, $3, 'operator'), ($4, $5, 'owner')`,
        [companyA.rows[0].id, platformAdmin.rows[0].id, customer.rows[0].id, companyB.rows[0].id, otherCompanyUser.rows[0].id]
      );
      await transaction.query('INSERT INTO platform_administrators (user_id) VALUES ($1)', [platformAdmin.rows[0].id]);
      const platformSession = await createStoredSession(transaction, {
        userId: platformAdmin.rows[0].id, organizationId: companyA.rows[0].id, config
      });
      const customerSessionA = await createStoredSession(transaction, {
        userId: customer.rows[0].id, organizationId: companyA.rows[0].id, config
      });
      const customerSessionB = await createStoredSession(transaction, {
        userId: customer.rows[0].id, organizationId: companyA.rows[0].id, config
      });
      return {
        companyAId: companyA.rows[0].id,
        companyBId: companyB.rows[0].id,
        platformAdmin: platformAdmin.rows[0],
        customer: customer.rows[0],
        otherCompanyUserId: otherCompanyUser.rows[0].id,
        userIds: [platformAdmin.rows[0].id, customer.rows[0].id, otherCompanyUser.rows[0].id],
        platformSession,
        customerSessionA,
        customerSessionB
      };
    });

    app = await buildApp({ config, db: database, logger: false });
    const platformHeaders = headersFor(fixture.platformSession);

    const listed = await app.inject({
      method: 'GET', url: `/api/v1/platform/companies/${fixture.companyAId}/users`, headers: platformHeaders
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().users.some(user => user.id === fixture.customer.id && user.role === 'operator'), true);
    assert.equal(listed.json().users.some(user => Object.hasOwn(user, 'temporaryPassword')), false);

    const crossCompany = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/companies/${fixture.companyAId}/users/${fixture.otherCompanyUserId}/temporary-password`,
      headers: platformHeaders
    });
    assert.equal(crossCompany.statusCode, 404);
    assert.equal(crossCompany.json().error.code, 'COMPANY_USER_NOT_FOUND');

    const protectedAccount = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/companies/${fixture.companyAId}/users/${fixture.platformAdmin.id}/temporary-password`,
      headers: platformHeaders
    });
    assert.equal(protectedAccount.statusCode, 403);
    assert.equal(protectedAccount.json().error.code, 'PLATFORM_ADMIN_PROTECTED');

    const reset = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/companies/${fixture.companyAId}/users/${fixture.customer.id}/temporary-password`,
      headers: platformHeaders
    });
    assert.equal(reset.statusCode, 200);
    const temporary = reset.json().user;
    assert.equal(temporary.id, fixture.customer.id);
    assert.match(temporary.temporaryPassword, /[a-z]/);
    assert.match(temporary.temporaryPassword, /[A-Z]/);
    assert.match(temporary.temporaryPassword, /[0-9]/);
    assert.match(temporary.temporaryPassword, /[!@#$%*\-_]/);
    assert.ok(temporary.temporaryPasswordExpiresAt);

    const stored = await database.query(
      'SELECT password_hash, force_password_change, temporary_password_expires_at FROM users WHERE id = $1',
      [fixture.customer.id]
    );
    assert.equal(stored.rows[0].force_password_change, true);
    assert.notEqual(stored.rows[0].password_hash, temporary.temporaryPassword);
    assert.ok(new Date(stored.rows[0].temporary_password_expires_at).getTime() > Date.now());

    for (const session of [fixture.customerSessionA, fixture.customerSessionB]) {
      const revoked = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: headersFor(session) });
      assert.equal(revoked.statusCode, 401);
    }

    const temporaryLogin = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email: fixture.customer.email, password: temporary.temporaryPassword }
    });
    assert.equal(temporaryLogin.statusCode, 200);
    assert.equal(temporaryLogin.json().user.passwordChangeRequired, true);
    const temporaryHeaders = { cookie: cookieFrom(temporaryLogin), 'x-csrf-token': temporaryLogin.json().csrfToken };

    const blocked = await app.inject({ method: 'GET', url: '/api/v1/profile', headers: temporaryHeaders });
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.json().error.code, 'PASSWORD_CHANGE_REQUIRED');

    const changed = await app.inject({
      method: 'POST', url: '/api/v1/auth/password/change', headers: temporaryHeaders,
      payload: { currentPassword: temporary.temporaryPassword, newPassword: 'NewCustomerPassword2026!' }
    });
    assert.equal(changed.statusCode, 200);
    const cleared = await database.query(
      'SELECT force_password_change, temporary_password_expires_at FROM users WHERE id = $1',
      [fixture.customer.id]
    );
    assert.equal(cleared.rows[0].force_password_change, false);
    assert.equal(cleared.rows[0].temporary_password_expires_at, null);

    const expiredReset = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/companies/${fixture.companyAId}/users/${fixture.customer.id}/temporary-password`,
      headers: platformHeaders
    });
    assert.equal(expiredReset.statusCode, 200);
    await database.query(
      "UPDATE users SET temporary_password_expires_at = now() - interval '1 minute' WHERE id = $1",
      [fixture.customer.id]
    );
    const expiredLogin = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email: fixture.customer.email, password: expiredReset.json().user.temporaryPassword }
    });
    assert.equal(expiredLogin.statusCode, 403);
    assert.equal(expiredLogin.json().error.code, 'TEMPORARY_PASSWORD_EXPIRED');
  } finally {
    if (fixture) {
      await database.transaction(async transaction => {
        await transaction.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[fixture.companyAId, fixture.companyBId]]);
        await transaction.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [fixture.userIds]);
      });
    }
    await app?.close();
    if (!app) await database.close();
  }
});
