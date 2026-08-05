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
    [name, `rls-${randomUUID()}`]
  );
  return result.rows[0].id;
};

const expectHiddenAndUnchanged = async (client, table, id, column) => {
  const selected = await client.query(`SELECT id FROM ${table} WHERE id = $1`, [id]);
  assert.equal(selected.rowCount, 0, `${table} from another organization must not be readable`);

  const updated = await client.query(`UPDATE ${table} SET ${column} = ${column} WHERE id = $1`, [id]);
  assert.equal(updated.rowCount, 0, `${table} from another organization must not be writable`);
};

test('RLS blocks cross-organization reads and writes for products, expenses and notifications', { skip: !enabled }, async () => {
  const config = loadConfig();
  assert.ok(config.databaseUrl, 'DATABASE_URL is required for the RLS integration test.');

  const database = createDatabase(config);
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const organizationA = await insertOrganization(client, 'RLS Company A');
    const organizationB = await insertOrganization(client, 'RLS Company B');
    const userA = randomUUID();

    const product = await client.query(
      "INSERT INTO products (organization_id, name, quantity, minimum_quantity) VALUES ($1, 'Product Company B', 1, 0) RETURNING id",
      [organizationB]
    );
    const expense = await client.query(
      `INSERT INTO expenses (organization_id, supplier_name, due_date, category, description, amount_cents)
       VALUES ($1, 'Supplier Company B', CURRENT_DATE, 'Test', 'Isolation expense', 100) RETURNING id`,
      [organizationB]
    );
    const notification = await client.query(
      "INSERT INTO notifications (organization_id, category, title, message) VALUES ($1, 'system', 'Notice B', 'Isolation notification') RETURNING id",
      [organizationB]
    );

    await client.query('SET LOCAL ROLE sev_tenant_api');
    await client.query(
      `SELECT set_config('app.organization_id', $1, true),
              set_config('app.user_id', $2, true)`,
      [organizationA, userA]
    );

    await expectHiddenAndUnchanged(client, 'products', product.rows[0].id, 'name');
    await expectHiddenAndUnchanged(client, 'expenses', expense.rows[0].id, 'description');
    await expectHiddenAndUnchanged(client, 'notifications', notification.rows[0].id, 'title');

    await assert.rejects(
      client.query(
        "INSERT INTO products (organization_id, name, quantity, minimum_quantity) VALUES ($1, 'Cross attempt', 1, 0)",
        [organizationB]
      ),
      error => error.code === '42501'
    );
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await database.close();
  }
});

test('authenticated API requests remain isolated even when given another organization record ID', { skip: !enabled }, async () => {
  const config = loadConfig();
  assert.ok(config.databaseUrl, 'DATABASE_URL is required for the RLS integration test.');

  const database = createDatabase(config);
  let app;
  let fixture;
  try {
    fixture = await database.transaction(async transaction => {
      const organizationA = await insertOrganization(transaction, 'API RLS Company A');
      const organizationB = await insertOrganization(transaction, 'API RLS Company B');
      const passwordHash = await hashPassword('TemporaryTestPassword2026');
      const userA = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        ['API RLS User A', `rls-a-${randomUUID()}@test.invalid`, passwordHash]
      );
      const userB = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        ['API RLS User B', `rls-b-${randomUUID()}@test.invalid`, passwordHash]
      );
      await transaction.query(
        "INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'owner')",
        [organizationA, userA.rows[0].id, organizationB, userB.rows[0].id]
      );
      const productB = await transaction.query(
        "INSERT INTO products (organization_id, name, quantity, minimum_quantity) VALUES ($1, 'Private Product B', 2, 0) RETURNING id",
        [organizationB]
      );
      const expenseB = await transaction.query(
        `INSERT INTO expenses (organization_id, supplier_name, due_date, category, description, amount_cents)
         VALUES ($1, 'Private Supplier B', CURRENT_DATE, 'Test', 'Private expense B', 100) RETURNING id`,
        [organizationB]
      );
      const notificationB = await transaction.query(
        "INSERT INTO notifications (organization_id, category, title, message) VALUES ($1, 'system', 'Private B', 'Private notification B') RETURNING id",
        [organizationB]
      );
      const sessionA = await createStoredSession(transaction, {
        userId: userA.rows[0].id,
        organizationId: organizationA,
        config
      });
      return {
        organizationA,
        organizationB,
        userIds: [userA.rows[0].id, userB.rows[0].id],
        sessionA,
        productBId: productB.rows[0].id,
        expenseBId: expenseB.rows[0].id,
        notificationBId: notificationB.rows[0].id
      };
    });

    app = await buildApp({ config: { ...config, environment: 'test' }, db: database, logger: false });
    const headers = {
      cookie: `${sessionCookieName}=${fixture.sessionA.token}`,
      'x-csrf-token': fixture.sessionA.csrfToken
    };

    const products = await app.inject({ method: 'GET', url: '/api/v1/products', headers });
    assert.equal(products.statusCode, 200);
    assert.equal(products.json().products.some(product => product.id === fixture.productBId), false);

    const expenses = await app.inject({ method: 'GET', url: '/api/v1/expenses', headers });
    assert.equal(expenses.statusCode, 200);
    assert.equal(expenses.json().expenses.some(expense => expense.id === fixture.expenseBId), false);

    const notifications = await app.inject({ method: 'GET', url: '/api/v1/notifications', headers });
    assert.equal(notifications.statusCode, 200);
    assert.equal(notifications.json().notifications.some(notification => notification.id === fixture.notificationBId), false);

    const foreignRead = await app.inject({
      method: 'PATCH',
      url: `/api/v1/notifications/${fixture.notificationBId}/read`,
      headers
    });
    assert.equal(foreignRead.statusCode, 200);
    assert.equal(foreignRead.json().notification, null);

    const productCreated = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers,
      payload: { name: 'Product Company A', quantity: 1, minimumQuantity: 0 }
    });
    assert.equal(productCreated.statusCode, 201);
    const persisted = await database.query('SELECT organization_id FROM products WHERE id = $1', [productCreated.json().product.id]);
    assert.equal(persisted.rows[0].organization_id, fixture.organizationA);
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
