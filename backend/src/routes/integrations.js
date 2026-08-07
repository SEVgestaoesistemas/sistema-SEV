import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { recordAudit } from '../audit.js';
import { requireAccountAccess, requireApiKey, requireApiScope, requireAuth, requireCsrf, requireRoles } from '../auth/middleware.js';
import { AppError } from '../errors.js';
import { createCriticalStockAlert } from '../stock-alerts.js';
import {
  createOrganizationApiKey,
  enforceApiRateLimit,
  hashApiKey,
  hashPayload,
  integrationScopes,
  listOrganizationApiKeys,
  revokeOrganizationApiKey
} from '../integrations/service.js';

const apiManagers = ['owner', 'admin'];
const paymentMethods = ['pix', 'card', 'cash', 'boleto', 'bank_transfer', 'other'];
const maximumCents = 1_000_000_000_000;
const text = maximum => z.string().trim().min(1).max(maximum);
const optionalText = maximum => z.string().trim().max(maximum).optional().transform(value => value || null);
const externalIdSchema = text(128).regex(/^[A-Za-z0-9._:-]+$/, 'Use apenas letras, numeros, ponto, sublinhado, dois-pontos ou hifen.');
const idempotencyKeySchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);

const keyCreateSchema = z.object({
  name: text(80),
  scopes: z.array(z.enum(integrationScopes)).min(1).max(integrationScopes.length).refine(
    values => new Set(values).size === values.length,
    'Nao repita escopos.'
  )
}).strict();

const productPayloadSchema = z.object({
  name: text(140).min(3),
  sku: optionalText(64),
  minimumQuantity: z.coerce.number().int().min(0).max(100_000_000).default(0),
  unitPriceCents: z.coerce.number().int().min(0).max(maximumCents).default(0)
}).strict();

const stockMovementPayloadSchema = z.object({
  externalMovementId: externalIdSchema,
  type: z.enum(['entry', 'exit', 'adjustment']),
  quantity: z.coerce.number().int().min(1).max(100_000_000).optional(),
  targetQuantity: z.coerce.number().int().min(0).max(100_000_000).optional(),
  note: optionalText(240)
}).strict().superRefine((value, context) => {
  if (['entry', 'exit'].includes(value.type) && value.quantity === undefined) {
    context.addIssue({ code: 'custom', path: ['quantity'], message: 'Informe uma quantidade positiva para entrada ou saida.' });
  }
  if (value.type === 'adjustment' && value.targetQuantity === undefined) {
    context.addIssue({ code: 'custom', path: ['targetQuantity'], message: 'Informe a quantidade final para um ajuste.' });
  }
  if (value.type === 'adjustment' && value.quantity !== undefined) {
    context.addIssue({ code: 'custom', path: ['quantity'], message: 'Use targetQuantity, e nao quantity, para um ajuste.' });
  }
});

const salePayloadSchema = z.object({
  customer: z.object({
    externalId: externalIdSchema,
    name: text(140).min(3),
    document: optionalText(18),
    email: z.union([z.string().trim().toLowerCase().email().max(160), z.literal('')]).optional().transform(value => value || null),
    phone: optionalText(24),
    notes: optionalText(500)
  }).strict(),
  paymentMethod: z.enum(paymentMethods),
  paymentStatus: z.string().trim(),
  items: z.array(z.object({
    productExternalId: externalIdSchema,
    quantity: z.coerce.number().int().min(1).max(100_000_000),
    unitPriceCents: z.coerce.number().int().min(1).max(maximumCents)
  }).strict()).min(1).max(100)
}).strict().superRefine((value, context) => {
  if (value.paymentStatus !== 'paid') {
    context.addIssue({
      code: 'custom',
      path: ['paymentStatus'],
      message: 'Vendas a prazo ainda nao sao suportadas pela API. Envie paymentStatus como "paid".'
    });
  }
  const ids = new Set();
  for (const [index, item] of value.items.entries()) {
    if (ids.has(item.productExternalId)) {
      context.addIssue({ code: 'custom', path: ['items', index, 'productExternalId'], message: 'Cada produto deve aparecer apenas uma vez na venda.' });
    }
    ids.add(item.productExternalId);
  }
});

const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

const validateIntegration = (schema, value) => {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new AppError('Dados invalidos para a integracao.', {
    statusCode: 422,
    code: 'VALIDATION_ERROR',
    details: parsed.error.issues.map(issue => ({ path: issue.path.join('.') || 'body', message: issue.message }))
  });
};

const normalizeDocument = document => document ? document.replace(/\D/g, '') || null : null;
const safeNumber = value => Number(value || 0);
const externalRouteOptions = (scope, ...handlers) => ({
  config: { rateLimit: false },
  preHandler: [requireApiKey, requireApiScope(scope), enforceApiRateLimit, ...handlers]
});

const publicProduct = product => ({
  id: product.id,
  externalId: product.externalId,
  name: product.name,
  sku: product.sku || null,
  quantity: safeNumber(product.quantity),
  minimumQuantity: safeNumber(product.minimumQuantity),
  unitPriceCents: safeNumber(product.unitPriceCents),
  updatedAt: product.updatedAt
});

const publicSale = sale => ({
  id: sale.id,
  externalId: sale.externalId,
  orderNumber: safeNumber(sale.orderNumber),
  customerId: sale.customerId,
  paymentMethod: sale.paymentMethod,
  paymentStatus: sale.paymentStatus,
  totalCents: safeNumber(sale.totalCents),
  createdAt: sale.createdAt,
  updated: Boolean(sale.updated)
});

const requestId = () => randomUUID();

const writeSyncLog = async (transaction, request, {
  requestId: logRequestId,
  eventType,
  externalId = null,
  status,
  httpStatus,
  errorCode = null,
  payloadSummary = {},
  payloadHash = null,
  startedAt
}) => transaction.query(
  `INSERT INTO api_sync_logs (
     organization_id, api_key_id, request_id, method, endpoint, event_type, external_id,
     status, http_status, error_code, payload_summary, payload_hash, source_ip, duration_ms
   ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14)`,
  [
    request.apiAuth.organizationId,
    request.apiAuth.id,
    logRequestId,
    request.method,
    request.routeOptions.url,
    eventType,
    externalId,
    status,
    httpStatus,
    errorCode,
    JSON.stringify(payloadSummary),
    payloadHash,
    request.clientIp || null,
    Math.max(0, Date.now() - startedAt)
  ]
);

const logExternalError = async (request, details, error) => {
  try {
    await request.tenantDb.transaction(transaction => writeSyncLog(transaction, request, {
      ...details,
      status: 'error',
      httpStatus: error instanceof AppError ? error.statusCode : 500,
      errorCode: error instanceof AppError ? error.code : 'INTERNAL_ERROR'
    }));
  } catch (loggingError) {
    request.log.warn({ err: loggingError }, 'Falha ao registrar log de sincronizacao');
  }
};

const getIdempotencyKey = request => {
  const value = request.headers['idempotency-key'];
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError('Informe um Idempotency-Key entre 8 e 128 caracteres para esta operacao.', {
      statusCode: 422,
      code: 'IDEMPOTENCY_KEY_REQUIRED'
    });
  }
  return parsed.data;
};

const runIdempotent = async (request, {
  operation,
  eventType,
  externalId,
  payload,
  payloadSummary,
  mutation
}) => {
  const startedAt = Date.now();
  const logRequestId = requestId();
  const idempotencyKeyHash = hashApiKey(getIdempotencyKey(request));
  const requestHash = hashPayload(payload);
  const logDetails = { requestId: logRequestId, eventType, externalId, payloadSummary, payloadHash: requestHash, startedAt };
  try {
    const outcome = await request.tenantDb.transaction(async transaction => {
      const previous = await transaction.query(
        `SELECT request_hash AS "requestHash", status_code AS "statusCode", response_body AS "responseBody", expires_at AS "expiresAt"
           FROM api_idempotency_keys
          WHERE organization_id = $1 AND api_key_id = $2 AND operation = $3 AND idempotency_key_hash = $4
          FOR UPDATE`,
        [request.apiAuth.organizationId, request.apiAuth.id, operation, idempotencyKeyHash]
      );
      const existing = previous.rows[0];
      if (existing && new Date(existing.expiresAt).getTime() > Date.now()) {
        if (existing.requestHash !== requestHash) {
          throw new AppError('Este Idempotency-Key ja foi usado com outro payload.', {
            statusCode: 409,
            code: 'IDEMPOTENCY_KEY_REUSED'
          });
        }
        return { statusCode: existing.statusCode, body: existing.responseBody, replayed: true };
      }

      const response = await mutation(transaction, requestHash);
      await transaction.query(
        `INSERT INTO api_idempotency_keys (
           organization_id, api_key_id, operation, idempotency_key_hash, request_hash, status_code, response_body, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now() + interval '7 days')
         ON CONFLICT (organization_id, api_key_id, operation, idempotency_key_hash) DO UPDATE
           SET request_hash = EXCLUDED.request_hash, status_code = EXCLUDED.status_code,
               response_body = EXCLUDED.response_body, created_at = now(), expires_at = EXCLUDED.expires_at`,
        [
          request.apiAuth.organizationId,
          request.apiAuth.id,
          operation,
          idempotencyKeyHash,
          requestHash,
          response.statusCode,
          JSON.stringify(response.body)
        ]
      );
      await writeSyncLog(transaction, request, { ...logDetails, status: 'success', httpStatus: response.statusCode });
      return { ...response, replayed: false };
    });
    if (outcome.replayed) {
      await request.tenantDb.transaction(transaction => writeSyncLog(transaction, request, {
        ...logDetails,
        status: 'replayed',
        httpStatus: outcome.statusCode
      }));
    }
    return outcome;
  } catch (error) {
    await logExternalError(request, logDetails, error);
    throw error;
  }
};

const calculateTotal = items => {
  let total = 0n;
  for (const item of items) {
    total += BigInt(item.quantity) * BigInt(item.unitPriceCents);
    if (total > BigInt(maximumCents)) {
      throw new AppError('O total da venda excede o limite permitido.', { statusCode: 422, code: 'VALIDATION_ERROR' });
    }
  }
  return Number(total);
};

const createOrUpdateCustomer = async (transaction, organizationId, customer) => {
  const existing = await transaction.query(
    `SELECT id FROM customers WHERE organization_id = $1 AND external_id = $2 FOR UPDATE`,
    [organizationId, customer.externalId]
  );
  const document = normalizeDocument(customer.document);
  if (document && ![11, 14].includes(document.length)) {
    throw new AppError('Informe um CPF ou CNPJ valido para o cliente.', {
      statusCode: 422,
      code: 'VALIDATION_ERROR',
      details: [{ path: 'customer.document', message: 'Informe um CPF ou CNPJ com 11 ou 14 digitos.' }]
    });
  }
  if (existing.rowCount) {
    const updated = await transaction.query(
      `UPDATE customers
          SET name = $3, document = $4, email = $5, phone = $6, notes = $7, is_active = true
        WHERE id = $1 AND organization_id = $2
        RETURNING id`,
      [existing.rows[0].id, organizationId, customer.name, document, customer.email, customer.phone, customer.notes]
    );
    return updated.rows[0].id;
  }
  const created = await transaction.query(
    `INSERT INTO customers (organization_id, external_id, name, document, email, phone, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [organizationId, customer.externalId, customer.name, document, customer.email, customer.phone, customer.notes]
  );
  return created.rows[0].id;
};

const loadProductsForSale = async (transaction, organizationId, externalIds) => {
  const result = await transaction.query(
    `SELECT id, external_id AS "externalId", name, quantity, minimum_quantity AS "minimumQuantity"
       FROM products
      WHERE organization_id = $1 AND external_id = ANY($2::text[])
      FOR UPDATE`,
    [organizationId, externalIds]
  );
  if (result.rowCount !== externalIds.length) {
    const found = new Set(result.rows.map(product => product.externalId));
    const missing = externalIds.find(externalId => !found.has(externalId));
    throw new AppError(`Produto externo "${missing}" nao encontrado nesta empresa.`, {
      statusCode: 422,
      code: 'SALES_REFERENCE_INVALID',
      details: [{ path: 'items', message: 'Cadastre ou sincronize o produto antes de enviar a venda.' }]
    });
  }
  return new Map(result.rows.map(product => [product.externalId, { ...product, quantity: safeNumber(product.quantity) }]));
};

const insertSaleItemsAndStock = async (transaction, request, sale, products, items, notePrefix) => {
  for (const item of items) {
    const product = products.get(item.productExternalId);
    if (product.quantity < item.quantity) {
      throw new AppError(`Estoque insuficiente para ${product.name}.`, { statusCode: 409, code: 'INSUFFICIENT_STOCK' });
    }
    const subtotalCents = Number(BigInt(item.quantity) * BigInt(item.unitPriceCents));
    await transaction.query(
      `INSERT INTO sale_items (organization_id, sale_id, product_id, product_name, quantity, unit_price_cents, subtotal_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [request.apiAuth.organizationId, sale.id, product.id, product.name, item.quantity, item.unitPriceCents, subtotalCents]
    );
    await transaction.query(
      `UPDATE products SET quantity = quantity - $3 WHERE id = $1 AND organization_id = $2`,
      [product.id, request.apiAuth.organizationId, item.quantity]
    );
    product.quantity -= item.quantity;
    await transaction.query(
      `INSERT INTO stock_movements (organization_id, product_id, actor_user_id, api_key_id, source_sale_id, movement_type, quantity_delta, note)
       VALUES ($1, $2, NULL, $3, $4, 'exit', $5, $6)`,
      [request.apiAuth.organizationId, product.id, request.apiAuth.id, sale.id, -item.quantity, `${notePrefix} #${sale.orderNumber}`]
    );
    if (product.quantity <= safeNumber(product.minimumQuantity)) {
      await createCriticalStockAlert(transaction, {
        organizationId: request.apiAuth.organizationId,
        title: 'Alerta de estoque crítico',
        message: `${product.name} está com ${product.quantity} unidade(s) após o pedido #${sale.orderNumber}.`
      });
    }
  }
};

export const registerIntegrationRoutes = async app => {
  app.get('/keys', {
    preHandler: [requireAuth, requireAccountAccess, requireRoles(apiManagers)]
  }, async request => ({ keys: await listOrganizationApiKeys(request.tenantDb, request.auth.organization.id) }));

  app.post('/keys', {
    preHandler: [requireAuth, requireCsrf, requireAccountAccess, requireRoles(apiManagers)]
  }, async (request, reply) => {
    const payload = validateIntegration(keyCreateSchema, request.body);
    const generated = await request.tenantDb.transaction(async transaction => {
      const result = await createOrganizationApiKey(transaction, {
        organizationId: request.auth.organization.id,
        userId: request.auth.id,
        name: payload.name,
        scopes: payload.scopes
      });
      await recordAudit(transaction, {
        organizationId: request.auth.organization.id,
        actorUserId: request.auth.id,
        action: 'integrations.api_key_created',
        entityType: 'organization_api_key',
        entityId: result.key.id,
        metadata: { scopes: result.key.scopes, name: result.key.name }
      });
      return result;
    });
    return reply.code(201).send(generated);
  });

  app.post('/keys/:keyId/revoke', {
    preHandler: [requireAuth, requireCsrf, requireAccountAccess, requireRoles(apiManagers)]
  }, async request => {
    const keyId = validateIntegration(z.object({ keyId: z.string().uuid() }), request.params).keyId;
    const key = await request.tenantDb.transaction(async transaction => {
      const revoked = await revokeOrganizationApiKey(transaction, {
        organizationId: request.auth.organization.id,
        keyId,
        userId: request.auth.id
      });
      await recordAudit(transaction, {
        organizationId: request.auth.organization.id,
        actorUserId: request.auth.id,
        action: 'integrations.api_key_revoked',
        entityType: 'organization_api_key',
        entityId: keyId,
        metadata: { name: revoked.name }
      });
      return revoked;
    });
    return { key };
  });

  const listLogs = async request => {
    const { limit } = validateIntegration(listQuerySchema, request.query);
    const result = await request.tenantDb.query(
      `SELECT id, request_id AS "requestId", method, endpoint, event_type AS "eventType", external_id AS "externalId",
              status, http_status AS "httpStatus", error_code AS "errorCode", payload_summary AS "payloadSummary",
              duration_ms AS "durationMs", created_at AS "createdAt"
         FROM api_sync_logs
        WHERE organization_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [request.apiAuth?.organizationId || request.auth.organization.id, limit]
    );
    return { logs: result.rows };
  };

  app.get('/logs', { preHandler: [requireAuth, requireAccountAccess, requireRoles(apiManagers)] }, listLogs);
  app.get('/v1/sync-logs', externalRouteOptions('sync-logs:read'), listLogs);

  app.put('/v1/products/:externalId', externalRouteOptions('inventory:write'), async (request, reply) => {
    const externalId = validateIntegration(z.object({ externalId: externalIdSchema }), request.params).externalId;
    const payload = validateIntegration(productPayloadSchema, request.body);
    const outcome = await runIdempotent(request, {
      operation: `product:${externalId}`,
      eventType: 'product.upsert',
      externalId,
      payload,
      payloadSummary: { name: payload.name, sku: payload.sku, minimumQuantity: payload.minimumQuantity },
      mutation: async transaction => {
        const current = await transaction.query(
          `SELECT id, external_id AS "externalId", name, sku, quantity, minimum_quantity AS "minimumQuantity",
                  unit_price_cents AS "unitPriceCents", updated_at AS "updatedAt"
             FROM products
            WHERE organization_id = $1 AND external_id = $2
            FOR UPDATE`,
          [request.apiAuth.organizationId, externalId]
        );
        let product;
        let statusCode;
        if (current.rowCount) {
          const result = await transaction.query(
            `UPDATE products
                SET name = $3, sku = $4, minimum_quantity = $5, unit_price_cents = $6
              WHERE id = $1 AND organization_id = $2
              RETURNING id, external_id AS "externalId", name, sku, quantity, minimum_quantity AS "minimumQuantity",
                        unit_price_cents AS "unitPriceCents", updated_at AS "updatedAt"`,
            [current.rows[0].id, request.apiAuth.organizationId, payload.name, payload.sku, payload.minimumQuantity, payload.unitPriceCents]
          );
          product = result.rows[0];
          statusCode = 200;
        } else {
          const result = await transaction.query(
            `INSERT INTO products (organization_id, external_id, name, sku, minimum_quantity, unit_price_cents)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, external_id AS "externalId", name, sku, quantity, minimum_quantity AS "minimumQuantity",
                       unit_price_cents AS "unitPriceCents", updated_at AS "updatedAt"`,
            [request.apiAuth.organizationId, externalId, payload.name, payload.sku, payload.minimumQuantity, payload.unitPriceCents]
          );
          product = result.rows[0];
          statusCode = 201;
        }
        await recordAudit(transaction, {
          organizationId: request.apiAuth.organizationId,
          action: 'integrations.product_upserted',
          entityType: 'product',
          entityId: product.id,
          metadata: { externalId, apiKeyId: request.apiAuth.id }
        });
        return { statusCode, body: { product: publicProduct(product) } };
      }
    });
    return reply.code(outcome.statusCode).send(outcome.body);
  });

  app.post('/v1/products/:externalId/stock-movements', externalRouteOptions('inventory:write'), async (request, reply) => {
    const productExternalId = validateIntegration(z.object({ externalId: externalIdSchema }), request.params).externalId;
    const payload = validateIntegration(stockMovementPayloadSchema, request.body);
    const outcome = await runIdempotent(request, {
      operation: `stock-movement:${payload.externalMovementId}`,
      eventType: 'stock.movement',
      externalId: payload.externalMovementId,
      payload: { productExternalId, ...payload },
      payloadSummary: { productExternalId, type: payload.type, quantity: payload.quantity, targetQuantity: payload.targetQuantity },
      mutation: async (transaction, payloadHash) => {
        const existingMovement = await transaction.query(
          `SELECT id, external_payload_hash AS "payloadHash" FROM stock_movements
            WHERE organization_id = $1 AND external_id = $2 FOR UPDATE`,
          [request.apiAuth.organizationId, payload.externalMovementId]
        );
        if (existingMovement.rowCount) {
          if (existingMovement.rows[0].payloadHash === payloadHash) {
            return { statusCode: 200, body: { movement: { id: existingMovement.rows[0].id, externalId: payload.externalMovementId, alreadyApplied: true } } };
          }
          throw new AppError('Este identificador externo de movimentacao ja foi usado com outros dados.', {
            statusCode: 409,
            code: 'EXTERNAL_ID_CONFLICT'
          });
        }
        const productResult = await transaction.query(
          `SELECT id, external_id AS "externalId", name, quantity, minimum_quantity AS "minimumQuantity",
                  unit_price_cents AS "unitPriceCents", updated_at AS "updatedAt"
             FROM products
            WHERE organization_id = $1 AND external_id = $2
            FOR UPDATE`,
          [request.apiAuth.organizationId, productExternalId]
        );
        if (!productResult.rowCount) {
          throw new AppError('Produto nao encontrado nesta empresa.', { statusCode: 422, code: 'PRODUCT_NOT_FOUND' });
        }
        const product = productResult.rows[0];
        const currentQuantity = safeNumber(product.quantity);
        const quantityDelta = payload.type === 'entry'
          ? payload.quantity
          : payload.type === 'exit'
            ? -payload.quantity
            : payload.targetQuantity - currentQuantity;
        if (quantityDelta === 0) {
          throw new AppError('O ajuste informado nao altera a quantidade atual.', { statusCode: 422, code: 'NO_STOCK_CHANGE' });
        }
        if (currentQuantity + quantityDelta < 0) {
          throw new AppError('A saida deixaria o estoque negativo.', { statusCode: 409, code: 'INSUFFICIENT_STOCK' });
        }
        const updatedResult = await transaction.query(
          `UPDATE products SET quantity = quantity + $3
            WHERE id = $1 AND organization_id = $2
            RETURNING id, external_id AS "externalId", name, sku, quantity, minimum_quantity AS "minimumQuantity",
                      unit_price_cents AS "unitPriceCents", updated_at AS "updatedAt"`,
          [product.id, request.apiAuth.organizationId, quantityDelta]
        );
        const movement = await transaction.query(
          `INSERT INTO stock_movements (
             organization_id, product_id, actor_user_id, api_key_id, external_id, external_payload_hash,
             movement_type, quantity_delta, note
           ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8)
           RETURNING id, external_id AS "externalId", movement_type AS type, quantity_delta AS "quantityDelta", created_at AS "createdAt"`,
          [request.apiAuth.organizationId, product.id, request.apiAuth.id, payload.externalMovementId, payloadHash, payload.type, quantityDelta, payload.note]
        );
        const updated = updatedResult.rows[0];
        if (safeNumber(updated.quantity) <= safeNumber(updated.minimumQuantity)) {
          await createCriticalStockAlert(transaction, {
            organizationId: request.apiAuth.organizationId,
            title: 'Alerta de estoque crítico',
            message: `${updated.name} está com ${updated.quantity} unidade(s) em estoque.`
          });
        }
        await recordAudit(transaction, {
          organizationId: request.apiAuth.organizationId,
          action: 'integrations.stock_movement_created',
          entityType: 'stock_movement',
          entityId: movement.rows[0].id,
          metadata: { productExternalId, externalMovementId: payload.externalMovementId, type: payload.type, quantityDelta, apiKeyId: request.apiAuth.id }
        });
        return { statusCode: 201, body: { movement: { ...movement.rows[0], quantityDelta: safeNumber(movement.rows[0].quantityDelta) }, product: publicProduct(updated) } };
      }
    });
    return reply.code(outcome.statusCode).send(outcome.body);
  });

  app.put('/v1/sales/:externalId', externalRouteOptions('sales:write'), async (request, reply) => {
    const externalId = validateIntegration(z.object({ externalId: externalIdSchema }), request.params).externalId;
    const payload = validateIntegration(salePayloadSchema, request.body);
    const totalCents = calculateTotal(payload.items);
    const outcome = await runIdempotent(request, {
      operation: `sale:${externalId}`,
      eventType: 'sale.upsert',
      externalId,
      payload,
      payloadSummary: { customerExternalId: payload.customer.externalId, paymentStatus: payload.paymentStatus, itemCount: payload.items.length, totalCents },
      mutation: async (transaction, payloadHash) => {
        const existing = await transaction.query(
          `SELECT id, external_id AS "externalId", external_payload_hash AS "payloadHash", order_number AS "orderNumber",
                  customer_id AS "customerId", payment_method AS "paymentMethod", payment_status AS "paymentStatus",
                  total_cents AS "totalCents", created_at AS "createdAt"
             FROM sales
            WHERE organization_id = $1 AND external_id = $2
            FOR UPDATE`,
          [request.apiAuth.organizationId, externalId]
        );
        if (existing.rowCount && existing.rows[0].payloadHash === payloadHash) {
          return { statusCode: 200, body: { sale: publicSale(existing.rows[0]) } };
        }
        const customerId = await createOrUpdateCustomer(transaction, request.apiAuth.organizationId, payload.customer);
        const productExternalIds = payload.items.map(item => item.productExternalId);
        const products = await loadProductsForSale(transaction, request.apiAuth.organizationId, productExternalIds);
        let sale;
        let statusCode;
        if (existing.rowCount) {
          sale = existing.rows[0];
          const oldItems = await transaction.query(
            `SELECT item.product_id AS "productId", item.quantity, product.external_id AS "externalId"
               FROM sale_items item
               JOIN products product ON product.id = item.product_id AND product.organization_id = item.organization_id
              WHERE item.organization_id = $1 AND item.sale_id = $2
              FOR UPDATE OF product`,
            [request.apiAuth.organizationId, sale.id]
          );
          for (const item of oldItems.rows) {
            const product = [...products.values()].find(entry => entry.id === item.productId);
            if (product) product.quantity += safeNumber(item.quantity);
            await transaction.query(
              `UPDATE products SET quantity = quantity + $3 WHERE id = $1 AND organization_id = $2`,
              [item.productId, request.apiAuth.organizationId, item.quantity]
            );
            await transaction.query(
              `INSERT INTO stock_movements (organization_id, product_id, actor_user_id, api_key_id, source_sale_id, movement_type, quantity_delta, note)
               VALUES ($1, $2, NULL, $3, $4, 'entry', $5, $6)`,
              [request.apiAuth.organizationId, item.productId, request.apiAuth.id, sale.id, item.quantity, `Correcao da venda externa #${sale.orderNumber}`]
            );
          }
          await transaction.query('DELETE FROM sale_items WHERE organization_id = $1 AND sale_id = $2', [request.apiAuth.organizationId, sale.id]);
          const updated = await transaction.query(
            `UPDATE sales
                SET customer_id = $3, payment_method = $4, payment_status = 'paid', due_date = NULL,
                    total_cents = $5, api_key_id = $6, external_payload_hash = $7
              WHERE id = $1 AND organization_id = $2
              RETURNING id, external_id AS "externalId", order_number AS "orderNumber", customer_id AS "customerId",
                        payment_method AS "paymentMethod", payment_status AS "paymentStatus", total_cents AS "totalCents", created_at AS "createdAt"`,
            [sale.id, request.apiAuth.organizationId, customerId, payload.paymentMethod, totalCents, request.apiAuth.id, payloadHash]
          );
          sale = { ...updated.rows[0], updated: true };
          statusCode = 200;
        } else {
          const created = await transaction.query(
            `INSERT INTO sales (
               organization_id, external_id, customer_id, payment_method, payment_status, due_date,
               total_cents, created_by_user_id, api_key_id, external_payload_hash
             ) VALUES ($1, $2, $3, $4, 'paid', NULL, $5, NULL, $6, $7)
             RETURNING id, external_id AS "externalId", order_number AS "orderNumber", customer_id AS "customerId",
                       payment_method AS "paymentMethod", payment_status AS "paymentStatus", total_cents AS "totalCents", created_at AS "createdAt"`,
            [request.apiAuth.organizationId, externalId, customerId, payload.paymentMethod, totalCents, request.apiAuth.id, payloadHash]
          );
          sale = created.rows[0];
          statusCode = 201;
        }
        await insertSaleItemsAndStock(transaction, request, sale, products, payload.items, statusCode === 200 ? 'Atualizacao API' : 'Venda API');
        await recordAudit(transaction, {
          organizationId: request.apiAuth.organizationId,
          action: statusCode === 200 ? 'integrations.sale_updated' : 'integrations.sale_created',
          entityType: 'sale',
          entityId: sale.id,
          metadata: { externalId, itemCount: payload.items.length, totalCents, apiKeyId: request.apiAuth.id, paymentStatus: 'paid' }
        });
        return { statusCode, body: { sale: publicSale(sale) } };
      }
    });
    return reply.code(outcome.statusCode).send(outcome.body);
  });
};
