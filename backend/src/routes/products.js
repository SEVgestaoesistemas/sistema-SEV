import { z } from 'zod';
import { recordAudit } from '../audit.js';
import { requireAccountAccess, requireAuth, requireCsrf, requireRoles } from '../auth/middleware.js';
import { createCriticalStockAlert } from '../stock-alerts.js';
import { validate } from './validation.js';

const productSchema = z.object({
  name: z.string().trim().min(3).max(140),
  sku: z.string().trim().min(1).max(64).optional(),
  quantity: z.coerce.number().int().min(0).max(100000000).default(0),
  minimumQuantity: z.coerce.number().int().min(0).max(100000000).default(0),
  unitPriceCents: z.coerce.number().int().min(0).max(1000000000000).default(0)
});

const inventoryReadRoles = ['owner', 'admin', 'finance', 'inventory', 'operator'];
const inventoryWriteRoles = ['owner', 'admin', 'inventory'];

const publicProduct = (product, { redactFinancialValues = false } = {}) => {
  const base = {
    id: product.id,
    name: product.name,
    sku: product.sku,
    quantity: product.quantity,
    minimumQuantity: product.minimumQuantity,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt
  };
  return redactFinancialValues
    ? { ...base, financialValuesRedacted: true }
    : { ...base, unitPriceCents: Number(product.unitPriceCents), financialValuesRedacted: false };
};

export const registerProductRoutes = async app => {
  app.get('/products', { preHandler: [requireAuth, requireAccountAccess, requireRoles(inventoryReadRoles)] }, async request => {
    const result = await request.tenantDb.query(
      `SELECT id, name, sku, quantity, minimum_quantity AS "minimumQuantity", unit_price_cents AS "unitPriceCents", created_at AS "createdAt", updated_at AS "updatedAt"
         FROM products
        WHERE organization_id = $1
        ORDER BY name ASC`,
      [request.auth.organization.id]
    );
    const redactFinancialValues = request.auth.organization.role === 'finance';
    return { products: result.rows.map(product => publicProduct(product, { redactFinancialValues })) };
  });

  app.post('/products', {
    preHandler: [requireAuth, requireCsrf, requireAccountAccess, requireRoles(inventoryWriteRoles)]
  }, async (request, reply) => {
    const payload = validate(productSchema, request.body);
    const product = await request.tenantDb.transaction(async transaction => {
      const result = await transaction.query(
        `INSERT INTO products (organization_id, name, sku, quantity, minimum_quantity, unit_price_cents)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, sku, quantity, minimum_quantity AS "minimumQuantity", unit_price_cents AS "unitPriceCents", created_at AS "createdAt"`,
        [request.auth.organization.id, payload.name, payload.sku || null, payload.quantity, payload.minimumQuantity, payload.unitPriceCents]
      );
      const created = result.rows[0];
      if (created.quantity > 0) {
        await transaction.query(
          `INSERT INTO stock_movements (organization_id, product_id, actor_user_id, movement_type, quantity_delta, note)
           VALUES ($1, $2, $3, 'initial', $4, 'Saldo inicial no cadastro')`,
          [request.auth.organization.id, created.id, request.auth.id, created.quantity]
        );
      }
      if (created.quantity <= created.minimumQuantity) {
        await createCriticalStockAlert(transaction, {
          organizationId: request.auth.organization.id,
          title: 'Alerta de estoque crítico',
          message: `${created.name} está com ${created.quantity} unidade(s) em estoque.`
        });
      }
      await recordAudit(transaction, {
        organizationId: request.auth.organization.id,
        actorUserId: request.auth.id,
        action: 'stock.product_created',
        entityType: 'product',
        entityId: created.id,
        metadata: { quantity: created.quantity, minimumQuantity: created.minimumQuantity }
      });
      return publicProduct(created);
    });
    return reply.code(201).send({ product });
  });
};
