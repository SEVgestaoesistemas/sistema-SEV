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
    [name, `team-settings-${randomUUID()}`]
  );
  return result.rows[0].id;
};

test('equipe e configurações permanecem isoladas por organização', { skip: !enabled }, async () => {
  const config = loadConfig();
  assert.ok(config.databaseUrl, 'DATABASE_URL is required for the team and settings integration test.');

  const database = createDatabase(config);
  let app;
  let fixture;
  try {
    fixture = await database.transaction(async transaction => {
      const organizationA = await insertOrganization(transaction, 'Team Settings Company A');
      const organizationB = await insertOrganization(transaction, 'Team Settings Company B');
      const passwordHash = await hashPassword('TemporaryTestPassword2026');
      const ownerA = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        ['Team Owner A', `team-owner-a-${randomUUID()}@test.invalid`, passwordHash]
      );
      const memberA = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        ['Team Member A', `team-member-a-${randomUUID()}@test.invalid`, passwordHash]
      );
      const ownerB = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        ['Team Owner B', `team-owner-b-${randomUUID()}@test.invalid`, passwordHash]
      );
      await transaction.query(
        `INSERT INTO organization_memberships (organization_id, user_id, role)
         VALUES ($1, $2, 'owner'), ($1, $3, 'inventory'), ($4, $5, 'owner')`,
        [organizationA, ownerA.rows[0].id, memberA.rows[0].id, organizationB, ownerB.rows[0].id]
      );
      const sessionA = await createStoredSession(transaction, { userId: ownerA.rows[0].id, organizationId: organizationA, config });
      const sessionB = await createStoredSession(transaction, { userId: ownerB.rows[0].id, organizationId: organizationB, config });
      return {
        organizationA,
        organizationB,
        ownerAId: ownerA.rows[0].id,
        memberAId: memberA.rows[0].id,
        userIds: [ownerA.rows[0].id, memberA.rows[0].id, ownerB.rows[0].id],
        sessionA,
        sessionB
      };
    });

    app = await buildApp({ config: { ...config, environment: 'test' }, db: database, logger: false });
    const headersA = {
      cookie: `${sessionCookieName}=${fixture.sessionA.token}`,
      'x-csrf-token': fixture.sessionA.csrfToken
    };
    const headersB = {
      cookie: `${sessionCookieName}=${fixture.sessionB.token}`,
      'x-csrf-token': fixture.sessionB.csrfToken
    };

    const teamA = await app.inject({ method: 'GET', url: '/api/v1/team', headers: headersA });
    assert.equal(teamA.statusCode, 200);
    assert.equal(teamA.json().members.some(member => member.id === fixture.memberAId), true);
    assert.equal(teamA.json().members.some(member => member.email.includes('team-owner-b-')), false);

    const invitation = await app.inject({
      method: 'POST', url: '/api/v1/team/invitations', headers: headersA,
      payload: { name: 'Invited Person', email: `invite-${randomUUID()}@test.invalid`, role: 'finance' }
    });
    assert.equal(invitation.statusCode, 201);
    assert.match(invitation.json().invitation.inviteLink, /#invite=/);

    const updatedRole = await app.inject({
      method: 'PATCH', url: `/api/v1/team/members/${fixture.memberAId}`, headers: headersA, payload: { role: 'finance' }
    });
    assert.equal(updatedRole.statusCode, 200);
    assert.equal(updatedRole.json().member.role, 'finance');

    const savedSettings = await app.inject({
      method: 'PATCH', url: '/api/v1/settings', headers: headersA,
      payload: { companyName: 'Company A Updated', companyShortName: 'CA', criticalStockAlerts: false }
    });
    assert.equal(savedSettings.statusCode, 200);
    assert.equal(savedSettings.json().settings.companyName, 'Company A Updated');
    assert.equal(savedSettings.json().settings.criticalStockAlerts, false);

    const settingsB = await app.inject({ method: 'GET', url: '/api/v1/settings', headers: headersB });
    assert.equal(settingsB.statusCode, 200);
    assert.notEqual(settingsB.json().settings.companyName, 'Company A Updated');
    assert.equal(settingsB.json().settings.criticalStockAlerts, true);

    const tenantB = database.forTenant({ organizationId: fixture.organizationB, userId: fixture.userIds[2] });
    const hiddenInvitation = await tenantB.query('SELECT id FROM team_invitations WHERE organization_id = $1', [fixture.organizationA]);
    const hiddenSettings = await tenantB.query('SELECT id FROM organizations WHERE id = $1', [fixture.organizationA]);
    assert.equal(hiddenInvitation.rowCount, 0);
    assert.equal(hiddenSettings.rowCount, 0);
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
