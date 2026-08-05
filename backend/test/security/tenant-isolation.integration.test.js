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

const xmlForImportTest = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc><NFe><infNFe Id="NFe35160812345678000190550010000001231000001234">
<ide><nNF>123</nNF><dhEmi>2026-08-05T10:30:00-03:00</dhEmi></ide>
<emit><CNPJ>12345678000190</CNPJ><xNome>Fornecedor de Importação Ltda</xNome></emit>
<det nItem="1"><prod><cProd>XML-1</cProd><xProd>Produto importado</xProd><qCom>2.0000</qCom><uCom>UN</uCom><vUnCom>25.0000</vUnCom><vProd>50.00</vProd></prod></det>
<total><ICMSTot><vNF>50.00</vNF></ICMSTot></total>
<cobr><dup><dVenc>2026-08-20</dVenc></dup></cobr>
</infNFe></NFe></nfeProc>`;

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

    const expenseCountBeforeRead = await database.query(
      'SELECT COUNT(*) AS count FROM expenses WHERE organization_id = $1',
      [fixture.organizationA]
    );
    assert.equal(Number(expenseCountBeforeRead.rows[0].count), 0);
    const parsedInvoice = await app.inject({
      method: 'POST',
      url: '/api/v1/expenses/parse-nfe-xml',
      headers,
      payload: { fileName: 'nota-fiscal.xml', xmlContent: xmlForImportTest }
    });
    assert.equal(parsedInvoice.statusCode, 200);
    assert.equal(parsedInvoice.json().invoice.supplierName, 'Fornecedor de Importação Ltda');
    assert.equal(parsedInvoice.json().invoice.amountCents, 5000);
    assert.equal(parsedInvoice.json().invoice.items.length, 1);

    const expenseCountAfterRead = await database.query(
      'SELECT COUNT(*) AS count FROM expenses WHERE organization_id = $1',
      [fixture.organizationA]
    );
    assert.equal(Number(expenseCountAfterRead.rows[0].count), 0, 'reading XML must not create an expense without confirmation');

    const confirmedImport = await app.inject({
      method: 'POST',
      url: '/api/v1/expenses',
      headers,
      payload: {
        supplierName: parsedInvoice.json().invoice.supplierName,
        supplierCnpj: parsedInvoice.json().invoice.supplierCnpj,
        documentNumber: parsedInvoice.json().invoice.documentNumber,
        documentKey: parsedInvoice.json().invoice.documentKey,
        issueDate: parsedInvoice.json().invoice.issueDate,
        dueDate: parsedInvoice.json().invoice.dueDate,
        category: parsedInvoice.json().invoice.category,
        description: parsedInvoice.json().invoice.description,
        amountCents: parsedInvoice.json().invoice.amountCents,
        documentFileName: 'nota-fiscal.xml',
        invoiceItems: parsedInvoice.json().invoice.items
      }
    });
    assert.equal(confirmedImport.statusCode, 201);
    assert.equal(confirmedImport.json().expense.invoiceItems.length, 1);
    const persistedImport = await database.query(
      `SELECT organization_id, invoice_items AS "invoiceItems"
         FROM expenses
        WHERE id = $1`,
      [confirmedImport.json().expense.id]
    );
    assert.equal(persistedImport.rows[0].organization_id, fixture.organizationA);
    assert.equal(persistedImport.rows[0].invoiceItems[0].description, 'Produto importado');
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

test('accounts receivable are created from pending sales and remain isolated by organization', { skip: !enabled }, async () => {
  const config = loadConfig();
  assert.ok(config.databaseUrl, 'DATABASE_URL is required for the accounts receivable isolation test.');

  const database = createDatabase(config);
  let app;
  let fixture;
  try {
    fixture = await database.transaction(async transaction => {
      const organizationA = await insertOrganization(transaction, 'Receivable Company A');
      const organizationB = await insertOrganization(transaction, 'Receivable Company B');
      const passwordHash = await hashPassword('TemporaryTestPassword2026');
      const userA = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        ['Receivable User A', `receivable-a-${randomUUID()}@test.invalid`, passwordHash]
      );
      const userB = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        ['Receivable User B', `receivable-b-${randomUUID()}@test.invalid`, passwordHash]
      );
      await transaction.query(
        "INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'owner')",
        [organizationA, userA.rows[0].id, organizationB, userB.rows[0].id]
      );
      const productA = await transaction.query(
        "INSERT INTO products (organization_id, name, quantity, minimum_quantity, unit_price_cents) VALUES ($1, 'Product Receivable A', 4, 0, 2500) RETURNING id",
        [organizationA]
      );
      const customerB = await transaction.query(
        "INSERT INTO customers (organization_id, name) VALUES ($1, 'Customer Receivable B') RETURNING id",
        [organizationB]
      );
      const saleB = await transaction.query(
        `INSERT INTO sales (organization_id, customer_id, payment_method, payment_status, due_date, total_cents, created_by_user_id)
         VALUES ($1, $2, 'boleto', 'pending', DATE '2035-06-20', 3600, $3) RETURNING id`,
        [organizationB, customerB.rows[0].id, userB.rows[0].id]
      );
      const receivableB = await transaction.query(
        'SELECT id FROM accounts_receivable WHERE sale_id = $1',
        [saleB.rows[0].id]
      );
      assert.equal(receivableB.rowCount, 1, 'a pending sale must automatically create one receivable');
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
        customerBId: customerB.rows[0].id,
        receivableBId: receivableB.rows[0].id,
        sessionA
      };
    });

    app = await buildApp({ config: { ...config, environment: 'test' }, db: database, logger: false });
    const headers = {
      cookie: `${sessionCookieName}=${fixture.sessionA.token}`,
      'x-csrf-token': fixture.sessionA.csrfToken
    };

    const customerCreated = await app.inject({
      method: 'POST',
      url: '/api/v1/customers',
      headers,
      payload: { name: 'Customer Receivable A' }
    });
    assert.equal(customerCreated.statusCode, 201);
    const pendingSale = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers,
      payload: {
        customerId: customerCreated.json().customer.id,
        paymentMethod: 'boleto',
        paymentStatus: 'pending',
        dueDate: '2035-06-20',
        items: [{ productId: fixture.productAId, quantity: 1, unitPriceCents: 2500 }]
      }
    });
    assert.equal(pendingSale.statusCode, 201);
    assert.equal(pendingSale.json().sale.paymentStatus, 'pending');

    const persistedReceivable = await database.query(
      `SELECT id, organization_id, sale_id, customer_id, amount_cents, due_date, status, paid_at
         FROM accounts_receivable
        WHERE sale_id = $1`,
      [pendingSale.json().sale.id]
    );
    assert.equal(persistedReceivable.rowCount, 1);
    assert.equal(persistedReceivable.rows[0].organization_id, fixture.organizationA);
    assert.equal(persistedReceivable.rows[0].customer_id, customerCreated.json().customer.id);
    assert.equal(Number(persistedReceivable.rows[0].amount_cents), 2500);
    assert.equal(persistedReceivable.rows[0].status, 'pending');
    const receivableAId = persistedReceivable.rows[0].id;

    const list = await app.inject({ method: 'GET', url: '/api/v1/receivables', headers });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().receivables.some(receivable => receivable.id === fixture.receivableBId), false);
    const ownReceivable = list.json().receivables.find(receivable => receivable.id === receivableAId);
    assert.ok(ownReceivable);
    assert.equal(ownReceivable.status, 'upcoming');

    const dashboardBeforePayment = await app.inject({ method: 'GET', url: '/api/v1/receivables/dashboard', headers });
    assert.equal(dashboardBeforePayment.statusCode, 200);
    assert.equal(dashboardBeforePayment.json().dashboard.pendingCents, 2500);
    assert.equal(dashboardBeforePayment.json().dashboard.pendingCount, 1);
    assert.equal(dashboardBeforePayment.json().dashboard.customers[0].customerName, 'Customer Receivable A');

    const tenantDatabase = database.forTenant({ organizationId: fixture.organizationA, userId: fixture.userAId });
    const foreignDirectRead = await tenantDatabase.query('SELECT id FROM accounts_receivable WHERE id = $1', [fixture.receivableBId]);
    assert.equal(foreignDirectRead.rowCount, 0);
    const foreignDirectUpdate = await tenantDatabase.query(
      'UPDATE accounts_receivable SET amount_cents = amount_cents WHERE id = $1',
      [fixture.receivableBId]
    );
    assert.equal(foreignDirectUpdate.rowCount, 0);

    const foreignPayment = await app.inject({
      method: 'PATCH',
      url: `/api/v1/receivables/${fixture.receivableBId}/mark-paid`,
      headers
    });
    assert.equal(foreignPayment.statusCode, 404);

    const payment = await app.inject({
      method: 'PATCH',
      url: `/api/v1/receivables/${receivableAId}/mark-paid`,
      headers
    });
    assert.equal(payment.statusCode, 200);
    assert.equal(payment.json().receivable.status, 'paid');

    const settled = await database.query(
      `SELECT receivable.status, receivable.paid_at, sale.payment_status, sale.due_date
         FROM accounts_receivable receivable
         JOIN sales sale ON sale.id = receivable.sale_id
        WHERE receivable.id = $1`,
      [receivableAId]
    );
    assert.equal(settled.rows[0].status, 'paid');
    assert.ok(settled.rows[0].paid_at);
    assert.equal(settled.rows[0].payment_status, 'paid');
    assert.equal(settled.rows[0].due_date, null);

    const dashboardAfterPayment = await app.inject({ method: 'GET', url: '/api/v1/receivables/dashboard', headers });
    assert.equal(dashboardAfterPayment.statusCode, 200);
    assert.equal(dashboardAfterPayment.json().dashboard.pendingCents, 0);
    assert.equal(dashboardAfterPayment.json().dashboard.pendingCount, 0);
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

test('CSV reports apply period filters and never export another organization data', { skip: !enabled }, async () => {
  const config = loadConfig();
  assert.ok(config.databaseUrl, 'DATABASE_URL is required for the reports isolation test.');

  const database = createDatabase(config);
  let app;
  let fixture;
  try {
    fixture = await database.transaction(async transaction => {
      const organizationA = await insertOrganization(transaction, 'Reports Company A');
      const organizationB = await insertOrganization(transaction, 'Reports Company B');
      const passwordHash = await hashPassword('TemporaryTestPassword2026');
      const userA = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        ['Reports User A', `reports-a-${randomUUID()}@test.invalid`, passwordHash]
      );
      const userB = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        ['Reports User B', `reports-b-${randomUUID()}@test.invalid`, passwordHash]
      );
      await transaction.query(
        "INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'owner')",
        [organizationA, userA.rows[0].id, organizationB, userB.rows[0].id]
      );
      const productA = await transaction.query(
        "INSERT INTO products (organization_id, name, quantity, minimum_quantity) VALUES ($1, '=Produto Formula A', 7, 1) RETURNING id",
        [organizationA]
      );
      const productB = await transaction.query(
        "INSERT INTO products (organization_id, name, quantity, minimum_quantity) VALUES ($1, 'PRODUTO-SEGREDO-B', 3, 1) RETURNING id",
        [organizationB]
      );
      await transaction.query(
        `INSERT INTO stock_movements (organization_id, product_id, actor_user_id, movement_type, quantity_delta, note, created_at)
         VALUES ($1, $2, $3, 'entry', 7, 'Movimentação A', '2026-08-05T12:00:00Z'),
                ($4, $5, $6, 'entry', 3, 'MOVIMENTO-SEGREDO-B', '2026-08-05T12:00:00Z')`,
        [organizationA, productA.rows[0].id, userA.rows[0].id, organizationB, productB.rows[0].id, userB.rows[0].id]
      );
      await transaction.query(
        `INSERT INTO expenses (organization_id, supplier_name, due_date, category, description, amount_cents)
         VALUES ($1, 'Fornecedor A', '2026-08-20', 'Teste', 'Despesa A', 1200),
                ($2, 'FORNECEDOR-SEGREDO-B', '2026-08-20', 'Teste', 'DESPESA-SEGREDO-B', 2200)`,
        [organizationA, organizationB]
      );
      const customerA = await transaction.query(
        "INSERT INTO customers (organization_id, name) VALUES ($1, 'Cliente Relatório A') RETURNING id",
        [organizationA]
      );
      const customerB = await transaction.query(
        "INSERT INTO customers (organization_id, name) VALUES ($1, 'CLIENTE-SEGREDO-B') RETURNING id",
        [organizationB]
      );
      await transaction.query(
        `INSERT INTO sales (organization_id, customer_id, payment_method, payment_status, due_date, total_cents, created_by_user_id, created_at)
         VALUES ($1, $2, 'boleto', 'pending', '2026-08-20', 4500, $3, '2026-08-05T12:00:00Z'),
                ($4, $5, 'boleto', 'pending', '2026-08-20', 9900, $6, '2026-08-05T12:00:00Z')`,
        [organizationA, customerA.rows[0].id, userA.rows[0].id, organizationB, customerB.rows[0].id, userB.rows[0].id]
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
        sessionA
      };
    });

    app = await buildApp({ config: { ...config, environment: 'test' }, db: database, logger: false });
    const headers = { cookie: `${sessionCookieName}=${fixture.sessionA.token}` };
    const query = '?startDate=2026-08-01&endDate=2026-08-31';
    const reports = [
      ['sales', 'Cliente Relatório A', 'CLIENTE-SEGREDO-B'],
      ['stock', "'=Produto Formula A", 'PRODUTO-SEGREDO-B'],
      ['expenses', 'Fornecedor A', 'FORNECEDOR-SEGREDO-B'],
      ['receivables', 'Cliente Relatório A', 'CLIENTE-SEGREDO-B']
    ];

    for (const [report, ownValue, foreignValue] of reports) {
      const response = await app.inject({ method: 'GET', url: `/api/v1/reports/${report}.csv${query}`, headers });
      assert.equal(response.statusCode, 200, `${report} report should be available`);
      assert.match(response.headers['content-type'], /text\/csv/);
      assert.ok(response.body.includes(ownValue), `${report} report should contain organization A data`);
      assert.equal(response.body.includes(foreignValue), false, `${report} report must not contain organization B data`);
    }

    const invalidPeriod = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/sales.csv?startDate=2026-08-31&endDate=2026-08-01',
      headers
    });
    assert.equal(invalidPeriod.statusCode, 400);
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
