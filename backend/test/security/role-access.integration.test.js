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

test('papéis bloqueiam rotas restritas e nunca expõem valores financeiros mascarados', { skip: !enabled }, async () => {
  const config = loadConfig();
  assert.ok(config.databaseUrl, 'DATABASE_URL is required for the role access integration test.');

  const database = createDatabase(config);
  let app;
  let fixture;
  try {
    fixture = await database.transaction(async transaction => {
      const passwordHash = await hashPassword('TemporaryTestPassword2026');
      const organization = await transaction.query(
        'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
        ['Role Access Company', `role-access-${randomUUID()}`]
      );
      const users = {};
      for (const role of ['owner', 'finance', 'inventory', 'operator']) {
        const user = await transaction.query(
          'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
          [`Role ${role}`, `role-${role}-${randomUUID()}@test.invalid`, passwordHash]
        );
        users[role] = user.rows[0].id;
      }
      await transaction.query(
        `INSERT INTO organization_memberships (organization_id, user_id, role)
         VALUES ($1, $2, 'owner'), ($1, $3, 'finance'), ($1, $4, 'inventory'), ($1, $5, 'operator')`,
        [organization.rows[0].id, users.owner, users.finance, users.inventory, users.operator]
      );
      const product = await transaction.query(
        `INSERT INTO products (organization_id, name, sku, quantity, minimum_quantity, unit_price_cents)
         VALUES ($1, 'Produto restrito', $2, 12, 2, 15990) RETURNING id`,
        [organization.rows[0].id, `ROLE-${randomUUID()}`]
      );
      const customer = await transaction.query(
        'INSERT INTO customers (organization_id, name) VALUES ($1, $2) RETURNING id',
        [organization.rows[0].id, 'Cliente de teste']
      );
      await transaction.query(
        `INSERT INTO sales (organization_id, customer_id, payment_method, payment_status, total_cents, created_by_user_id)
         VALUES ($1, $2, 'pix', 'paid', 15990, $3)`,
        [organization.rows[0].id, customer.rows[0].id, users.owner]
      );
      await transaction.query(
        `INSERT INTO expenses (organization_id, supplier_name, due_date, category, description, amount_cents, status)
         VALUES ($1, 'Test supplier', CURRENT_DATE, 'Operational', 'Confirmed expense', 1990, 'paid'),
                ($1, 'Cancelled supplier', CURRENT_DATE, 'Operational', 'Cancelled expense', 5000, 'cancelled')`,
        [organization.rows[0].id]
      );
      const sessions = {};
      for (const [role, userId] of Object.entries(users)) {
        sessions[role] = await createStoredSession(transaction, {
          userId,
          organizationId: organization.rows[0].id,
          config
        });
      }
      return {
        organizationId: organization.rows[0].id,
        userIds: Object.values(users),
        productId: product.rows[0].id,
        customerId: customer.rows[0].id,
        sessions
      };
    });

    app = await buildApp({ config: { ...config, environment: 'test' }, db: database, logger: false });
    const financeHeaders = headersFor(fixture.sessions.finance);
    const inventoryHeaders = headersFor(fixture.sessions.inventory);
    const operatorHeaders = headersFor(fixture.sessions.operator);

    const financeProducts = await app.inject({ method: 'GET', url: '/api/v1/products', headers: financeHeaders });
    assert.equal(financeProducts.statusCode, 200);
    assert.equal(financeProducts.json().products[0].financialValuesRedacted, true);
    assert.equal(Object.hasOwn(financeProducts.json().products[0], 'unitPriceCents'), false);

    const financeSales = await app.inject({ method: 'GET', url: '/api/v1/sales', headers: financeHeaders });
    assert.equal(financeSales.statusCode, 200);
    assert.equal(financeSales.json().sales[0].financialValuesRedacted, true);
    assert.equal(Object.hasOwn(financeSales.json().sales[0], 'totalCents'), false);

    const financeSalesDashboard = await app.inject({ method: 'GET', url: '/api/v1/sales/dashboard', headers: financeHeaders });
    assert.equal(financeSalesDashboard.statusCode, 200);
    assert.equal(financeSalesDashboard.json().dashboard.summary.revenueCents, null);
    assert.equal(Object.hasOwn(financeSalesDashboard.json().dashboard.paymentMethods[0], 'totalCents'), false);

    const financeDashboard = await app.inject({ method: 'GET', url: '/api/v1/finance/dashboard', headers: financeHeaders });
    assert.equal(financeDashboard.statusCode, 200);
    assert.equal(financeDashboard.json().dashboard.summary.revenueCents, 15990);
    assert.deepEqual(financeDashboard.json().dashboard.financialSummary, {
      revenueCents: 15990,
      expenseCents: 1990,
      balanceCents: 14000
    });

    const financeProductWrite = await app.inject({
      method: 'POST', url: '/api/v1/products', headers: financeHeaders,
      payload: { name: 'Produto não permitido', quantity: 1, minimumQuantity: 0 }
    });
    assert.equal(financeProductWrite.statusCode, 403);

    const financeSaleWrite = await app.inject({ method: 'POST', url: '/api/v1/sales', headers: financeHeaders, payload: {} });
    assert.equal(financeSaleWrite.statusCode, 403);

    const financeSalesReport = await app.inject({ method: 'GET', url: '/api/v1/reports/sales.xlsx', headers: financeHeaders });
    assert.equal(financeSalesReport.statusCode, 403);

    const inventorySales = await app.inject({ method: 'GET', url: '/api/v1/sales', headers: inventoryHeaders });
    assert.equal(inventorySales.statusCode, 200);
    const inventorySaleWrite = await app.inject({ method: 'POST', url: '/api/v1/sales', headers: inventoryHeaders, payload: {} });
    assert.equal(inventorySaleWrite.statusCode, 403);
    const inventoryFinance = await app.inject({ method: 'GET', url: '/api/v1/expenses', headers: inventoryHeaders });
    assert.equal(inventoryFinance.statusCode, 403);
    const inventoryTeam = await app.inject({ method: 'GET', url: '/api/v1/team', headers: inventoryHeaders });
    assert.equal(inventoryTeam.statusCode, 403);
    const inventorySettings = await app.inject({ method: 'GET', url: '/api/v1/settings', headers: inventoryHeaders });
    assert.equal(inventorySettings.statusCode, 403);

    const operatorProductWrite = await app.inject({ method: 'POST', url: '/api/v1/products', headers: operatorHeaders, payload: {} });
    assert.equal(operatorProductWrite.statusCode, 403);
    const operatorSale = await app.inject({
      method: 'POST', url: '/api/v1/sales', headers: operatorHeaders,
      payload: {
        customerId: fixture.customerId,
        paymentMethod: 'pix',
        paymentStatus: 'paid',
        items: [{ productId: fixture.productId, quantity: 1, unitPriceCents: 15990 }]
      }
    });
    assert.equal(operatorSale.statusCode, 201);
    assert.equal(operatorSale.json().sale.totalCents, 15990);
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
