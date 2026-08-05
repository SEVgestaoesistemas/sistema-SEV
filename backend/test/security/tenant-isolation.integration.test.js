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
        userAId: userA.rows[0].id,
        userBId: userB.rows[0].id,
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

    const avatarData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL3iQAAAABJRU5ErkJggg==';
    const profileUpdated = await app.inject({
      method: 'PATCH',
      url: '/api/v1/profile',
      headers,
      payload: {
        name: 'API RLS User A Updated',
        email: `rls-a-updated-${randomUUID()}@test.invalid`,
        avatarData
      }
    });
    assert.equal(profileUpdated.statusCode, 200);
    assert.equal(profileUpdated.json().profile.avatarData, avatarData);
    const persistedProfile = await database.query(
      'SELECT name, email, avatar_data AS "avatarData" FROM users WHERE id = $1',
      [fixture.userAId]
    );
    assert.equal(persistedProfile.rows[0].avatarData, avatarData);
    const otherProfile = await database.query('SELECT avatar_data AS "avatarData" FROM users WHERE id = $1', [fixture.userBId]);
    assert.equal(otherProfile.rows[0].avatarData, null);

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

test('sales keep customers, orders and stock movements isolated by organization', { skip: !enabled }, async () => {
  const config = loadConfig();
  assert.ok(config.databaseUrl, 'DATABASE_URL is required for the sales isolation test.');

  const database = createDatabase(config);
  let app;
  let fixture;
  try {
    fixture = await database.transaction(async transaction => {
      const organizationA = await insertOrganization(transaction, 'Sales Company A');
      const organizationB = await insertOrganization(transaction, 'Sales Company B');
      const passwordHash = await hashPassword('TemporaryTestPassword2026');
      const userA = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        ['Sales User A', `sales-a-${randomUUID()}@test.invalid`, passwordHash]
      );
      const userB = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        ['Sales User B', `sales-b-${randomUUID()}@test.invalid`, passwordHash]
      );
      await transaction.query(
        "INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'owner')",
        [organizationA, userA.rows[0].id, organizationB, userB.rows[0].id]
      );
      const productA = await transaction.query(
        "INSERT INTO products (organization_id, name, quantity, minimum_quantity, unit_price_cents) VALUES ($1, 'Product Sales A', 5, 1, 2500) RETURNING id",
        [organizationA]
      );
      const productB = await transaction.query(
        "INSERT INTO products (organization_id, name, quantity, minimum_quantity, unit_price_cents) VALUES ($1, 'Product Sales B', 5, 1, 2500) RETURNING id",
        [organizationB]
      );
      const customerB = await transaction.query(
        "INSERT INTO customers (organization_id, name) VALUES ($1, 'Customer Sales B') RETURNING id",
        [organizationB]
      );
      const saleB = await transaction.query(
        `INSERT INTO sales (organization_id, customer_id, payment_method, payment_status, total_cents, created_by_user_id)
         VALUES ($1, $2, 'pix', 'paid', 2500, $3) RETURNING id`,
        [organizationB, customerB.rows[0].id, userB.rows[0].id]
      );
      await transaction.query(
        `INSERT INTO sale_items (organization_id, sale_id, product_id, product_name, quantity, unit_price_cents, subtotal_cents)
         VALUES ($1, $2, $3, 'Product Sales B', 1, 2500, 2500)`,
        [organizationB, saleB.rows[0].id, productB.rows[0].id]
      );
      const sessionA = await createStoredSession(transaction, {
        userId: userA.rows[0].id,
        organizationId: organizationA,
        config
      });
      return {
        organizationA,
        organizationB,
        userAId: userA.rows[0].id,
        userIds: [userA.rows[0].id, userB.rows[0].id],
        productAId: productA.rows[0].id,
        productBId: productB.rows[0].id,
        customerBId: customerB.rows[0].id,
        saleBId: saleB.rows[0].id,
        sessionA
      };
    });

    app = await buildApp({ config: { ...config, environment: 'test' }, db: database, logger: false });
    const headers = {
      cookie: `${sessionCookieName}=${fixture.sessionA.token}`,
      'x-csrf-token': fixture.sessionA.csrfToken
    };

    const customers = await app.inject({ method: 'GET', url: '/api/v1/customers', headers });
    assert.equal(customers.statusCode, 200);
    assert.equal(customers.json().customers.some(customer => customer.id === fixture.customerBId), false);
    const sales = await app.inject({ method: 'GET', url: '/api/v1/sales', headers });
    assert.equal(sales.statusCode, 200);
    assert.equal(sales.json().sales.some(sale => sale.id === fixture.saleBId), false);

    const foreignOrder = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers,
      payload: {
        customerId: fixture.customerBId,
        paymentMethod: 'pix',
        paymentStatus: 'paid',
        items: [{ productId: fixture.productBId, quantity: 1, unitPriceCents: 2500 }]
      }
    });
    assert.equal(foreignOrder.statusCode, 400);
    assert.equal(foreignOrder.json().error.code, 'SALES_REFERENCE_INVALID');

    const customerCreated = await app.inject({
      method: 'POST',
      url: '/api/v1/customers',
      headers,
      payload: { name: 'Customer Sales A', email: `customer-a-${randomUUID()}@test.invalid` }
    });
    assert.equal(customerCreated.statusCode, 201);
    const saleCreated = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers,
      payload: {
        customerId: customerCreated.json().customer.id,
        paymentMethod: 'pix',
        paymentStatus: 'paid',
        items: [{ productId: fixture.productAId, quantity: 2, unitPriceCents: 2500 }]
      }
    });
    assert.equal(saleCreated.statusCode, 201);
    assert.equal(saleCreated.json().sale.totalCents, 5000);

    const productAfterSale = await database.query('SELECT quantity FROM products WHERE id = $1', [fixture.productAId]);
    assert.equal(productAfterSale.rows[0].quantity, 3);
    const persistedSale = await database.query('SELECT organization_id FROM sales WHERE id = $1', [saleCreated.json().sale.id]);
    assert.equal(persistedSale.rows[0].organization_id, fixture.organizationA);
    const movement = await database.query(
      "SELECT quantity_delta FROM stock_movements WHERE organization_id = $1 AND product_id = $2 AND movement_type = 'exit'",
      [fixture.organizationA, fixture.productAId]
    );
    assert.equal(movement.rows[0].quantity_delta, -2);

    const tenantDatabase = database.forTenant({ organizationId: fixture.organizationA, userId: fixture.userAId });
    const foreignCustomer = await tenantDatabase.query('SELECT id FROM customers WHERE id = $1', [fixture.customerBId]);
    const foreignSale = await tenantDatabase.query('SELECT id FROM sales WHERE id = $1', [fixture.saleBId]);
    assert.equal(foreignCustomer.rowCount, 0);
    assert.equal(foreignSale.rowCount, 0);

    const dashboard = await app.inject({ method: 'GET', url: '/api/v1/sales/dashboard', headers });
    assert.equal(dashboard.statusCode, 200);
    assert.equal(dashboard.json().dashboard.summary.revenueCents, 5000);
    assert.equal(dashboard.json().dashboard.summary.orderCount, 1);
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
