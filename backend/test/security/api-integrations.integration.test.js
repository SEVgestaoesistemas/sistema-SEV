import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../src/config.js';
import { createDatabase } from '../../src/db/database.js';
import { buildApp } from '../../src/app.js';
import { createStoredSession } from '../../src/auth/service.js';
import { hashPassword } from '../../src/security/password.js';
import { sessionCookieName } from '../../src/security/session.js';
import { generateApiKey } from '../../src/integrations/service.js';

const enabled = process.env.RUN_DATABASE_SECURITY_TESTS === 'true';

const createOrganization = async (database, name) => {
  const result = await database.query(
    'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
    [name, `integration-${randomUUID()}`]
  );
  return result.rows[0].id;
};

const externalHeaders = (key, idempotencyKey) => ({
  authorization: `Bearer ${key}`,
  'idempotency-key': idempotencyKey
});

test('API de integraÃ§Ã£o isola empresas, exige escopo, revoga chaves e processa operaÃ§Ãµes idempotentes', { skip: !enabled }, async () => {
  const config = loadConfig();
  assert.ok(config.databaseUrl, 'DATABASE_URL is required for the API integrations security test.');
  const database = createDatabase(config);
  let app;
  let fixture;
  try {
    fixture = await database.transaction(async transaction => {
      const organizationA = await createOrganization(transaction, 'Integration Company A');
      const organizationB = await createOrganization(transaction, 'Integration Company B');
      const passwordHash = await hashPassword('TemporaryTestPassword2026');
      const userA = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        ['Integration Owner A', `integration-a-${randomUUID()}@test.invalid`, passwordHash]
      );
      const userB = await transaction.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        ['Integration Owner B', `integration-b-${randomUUID()}@test.invalid`, passwordHash]
      );
      await transaction.query(
        "INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'owner')",
        [organizationA, userA.rows[0].id, organizationB, userB.rows[0].id]
      );
      await transaction.query(
        `INSERT INTO products (organization_id, external_id, name, quantity, minimum_quantity, unit_price_cents)
         VALUES ($1, 'private-b-product', 'Private Product B', 4, 0, 1000)`,
        [organizationB]
      );
      const session = await createStoredSession(transaction, {
        userId: userA.rows[0].id,
        organizationId: organizationA,
        config
      });
      return {
        organizationA,
        organizationB,
        userAId: userA.rows[0].id,
        userIds: [userA.rows[0].id, userB.rows[0].id],
        session
      };
    });
    app = await buildApp({
      config: { ...config, environment: 'test', integrationApiRateLimitMax: 1000, integrationApiDailyLimit: 10000 },
      db: database,
      logger: false
    });
    const managerHeaders = {
      cookie: `${sessionCookieName}=${fixture.session.token}`,
      'x-csrf-token': fixture.session.csrfToken
    };
    const createdKey = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/keys',
      headers: managerHeaders,
      payload: { name: 'ERP principal', scopes: ['inventory:write', 'sales:write', 'sync-logs:read'] }
    });
    assert.equal(createdKey.statusCode, 201);
    const apiKey = createdKey.json().apiKey;
    const apiKeyId = createdKey.json().key.id;
    assert.match(apiKey, /^sev_live_/);
    const storedKey = await database.query('SELECT key_hash FROM organization_api_keys WHERE id = $1', [apiKeyId]);
    assert.notEqual(storedKey.rows[0].key_hash, apiKey, 'the raw API key must never be persisted');
    assert.match(storedKey.rows[0].key_hash, /^[a-f0-9]{64}$/);

    const salesOnly = generateApiKey();
    await database.query(
      `INSERT INTO organization_api_keys (organization_id, name, key_prefix, key_hash, scopes)
       VALUES ($1, 'Sales only', $2, $3, ARRAY['sales:write']::text[])`,
      [fixture.organizationA, salesOnly.prefix, salesOnly.hash]
    );
    const foreignKey = generateApiKey();
    await database.query(
      `INSERT INTO organization_api_keys (organization_id, name, key_prefix, key_hash, scopes)
       VALUES ($1, 'Company B key', $2, $3, ARRAY['inventory:write']::text[])`,
      [fixture.organizationB, foreignKey.prefix, foreignKey.hash]
    );

    const noInventoryScope = await app.inject({
      method: 'PUT',
      url: '/api/v1/integrations/v1/products/product-a',
      headers: externalHeaders(salesOnly.secret, 'scope-test-0001'),
      payload: { name: 'Product A', minimumQuantity: 1, unitPriceCents: 1500 }
    });
    assert.equal(noInventoryScope.statusCode, 403);
    assert.equal(noInventoryScope.json().error.code, 'API_SCOPE_FORBIDDEN');

    const product = await app.inject({
      method: 'PUT',
      url: '/api/v1/integrations/v1/products/product-a',
      headers: externalHeaders(apiKey, 'product-a-create-0001'),
      payload: { name: 'Product A', sku: 'A-1', minimumQuantity: 1, unitPriceCents: 1500 }
    });
    assert.equal(product.statusCode, 201);
    assert.equal(product.json().product.quantity, 0);

    const movementPayload = { externalMovementId: 'entry-a-0001', type: 'entry', quantity: 5 };
    const stockEntry = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/v1/products/product-a/stock-movements',
      headers: externalHeaders(apiKey, 'stock-entry-a-0001'),
      payload: movementPayload
    });
    assert.equal(stockEntry.statusCode, 201);
    const stockRetry = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/v1/products/product-a/stock-movements',
      headers: externalHeaders(apiKey, 'stock-entry-a-0001'),
      payload: movementPayload
    });
    assert.equal(stockRetry.statusCode, 201);
    const movementCount = await database.query(
      "SELECT COUNT(*)::int AS count FROM stock_movements WHERE organization_id = $1 AND external_id = 'entry-a-0001'",
      [fixture.organizationA]
    );
    assert.equal(movementCount.rows[0].count, 1, 'a retried idempotent request must not duplicate stock');

    const foreignProduct = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/v1/products/private-b-product/stock-movements',
      headers: externalHeaders(apiKey, 'foreign-product-0001'),
      payload: { externalMovementId: 'foreign-movement-1', type: 'exit', quantity: 1 }
    });
    assert.equal(foreignProduct.statusCode, 422);
    const unchangedForeignProduct = await database.query(
      "SELECT quantity FROM products WHERE organization_id = $1 AND external_id = 'private-b-product'",
      [fixture.organizationB]
    );
    assert.equal(unchangedForeignProduct.rows[0].quantity, 4);

    const pendingSale = await app.inject({
      method: 'PUT',
      url: '/api/v1/integrations/v1/sales/pending-sale-1',
      headers: externalHeaders(apiKey, 'pending-sale-0001'),
      payload: {
        customer: { externalId: 'customer-a', name: 'Customer A' },
        paymentMethod: 'pix',
        paymentStatus: 'pending',
        items: [{ productExternalId: 'product-a', quantity: 1, unitPriceCents: 1500 }]
      }
    });
    assert.equal(pendingSale.statusCode, 422);
    assert.equal(pendingSale.json().error.code, 'VALIDATION_ERROR');
    assert.match(pendingSale.json().error.details[0].message, /a prazo/);

    const salePayload = {
      customer: { externalId: 'customer-a', name: 'Customer A' },
      paymentMethod: 'pix',
      paymentStatus: 'paid',
      items: [{ productExternalId: 'product-a', quantity: 2, unitPriceCents: 1500 }]
    };
    const sale = await app.inject({
      method: 'PUT',
      url: '/api/v1/integrations/v1/sales/sale-a-1',
      headers: externalHeaders(apiKey, 'sale-a-create-0001'),
      payload: salePayload
    });
    assert.equal(sale.statusCode, 201);
    assert.equal(sale.json().sale.paymentStatus, 'paid');
    const changedRetry = await app.inject({
      method: 'PUT',
      url: '/api/v1/integrations/v1/sales/sale-a-1',
      headers: externalHeaders(apiKey, 'sale-a-create-0001'),
      payload: { ...salePayload, items: [{ productExternalId: 'product-a', quantity: 1, unitPriceCents: 1500 }] }
    });
    assert.equal(changedRetry.statusCode, 409);
    assert.equal(changedRetry.json().error.code, 'IDEMPOTENCY_KEY_REUSED');

    const insufficientStock = await app.inject({
      method: 'PUT',
      url: '/api/v1/integrations/v1/sales/sale-a-too-large',
      headers: externalHeaders(apiKey, 'sale-a-rollback-0001'),
      payload: { ...salePayload, items: [{ productExternalId: 'product-a', quantity: 99, unitPriceCents: 1500 }] }
    });
    assert.equal(insufficientStock.statusCode, 409);
    assert.equal(insufficientStock.json().error.code, 'INSUFFICIENT_STOCK');
    const persisted = await database.query(
      `SELECT (SELECT COUNT(*)::int FROM sales WHERE organization_id = $1) AS "saleCount",
              (SELECT quantity FROM products WHERE organization_id = $1 AND external_id = 'product-a') AS quantity,
              (SELECT COUNT(*)::int FROM accounts_receivable WHERE organization_id = $1) AS "receivableCount"`,
      [fixture.organizationA]
    );
    assert.equal(persisted.rows[0].saleCount, 1, 'failed sale must roll back completely');
    assert.equal(persisted.rows[0].quantity, 3, 'failed sale must not change stock');
    assert.equal(persisted.rows[0].receivableCount, 0, 'paid API sales must not create accounts receivable');

    const tenantA = database.forTenant({ organizationId: fixture.organizationA, userId: fixture.userAId });
    const inaccessibleForeignKey = await tenantA.query(
      'SELECT id FROM organization_api_keys WHERE organization_id = $1',
      [fixture.organizationB]
    );
    assert.equal(inaccessibleForeignKey.rowCount, 0, 'RLS must hide another organization API keys');
    await assert.rejects(
      tenantA.query(
        `INSERT INTO api_sync_logs (organization_id, api_key_id, request_id, method, endpoint, event_type, status, http_status)
         VALUES ($1, $2, $3, 'POST', '/cross-org', 'test', 'success', 200)`,
        [fixture.organizationB, apiKeyId, randomUUID()]
      ),
      error => error.code === '42501'
    );

    const revoked = await app.inject({
      method: 'POST',
      url: `/api/v1/integrations/keys/${apiKeyId}/revoke`,
      headers: managerHeaders
    });
    assert.equal(revoked.statusCode, 200);
    const afterRevocation = await app.inject({
      method: 'PUT',
      url: '/api/v1/integrations/v1/products/product-after-revoke',
      headers: externalHeaders(apiKey, 'after-revoke-0001'),
      payload: { name: 'Should be rejected', minimumQuantity: 0, unitPriceCents: 100 }
    });
    assert.equal(afterRevocation.statusCode, 401);
    assert.equal(afterRevocation.json().error.code, 'API_KEY_REVOKED');
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
