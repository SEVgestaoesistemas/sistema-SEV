import { z } from 'zod';
import { recordAudit } from '../audit.js';
import { requireAuth, requireCsrf, requireRoles } from '../auth/middleware.js';
import { validate } from './validation.js';

const productSchema = z.object({
  name: z.string().trim().min(3).max(140),
  sku: z.string().trim().min(1).max(64).optional(),
  quantity: z.coerce.number().int().min(0).max(100000000).default(0),
  minimumQuantity: z.coerce.number().int().min(0).max(100000000).default(0)
});

const inventoryRoles = ['owner', 'admin', 'inventory'];

export const registerProductRoutes = async app => {
  app.get('/products', { preHandler: [requireAuth, requireRoles(inventoryRoles)] }, async request => {
    const result = await app.db.query(
      `SELECT id, name, sku, quantity, minimum_quantity AS "minimumQuantity", created_at AS "createdAt", updated_at AS "updatedAt"
         FROM products
        WHERE organization_id = $1
        ORDER BY name ASC`,
      [request.auth.organization.id]
    );
    return { products: result.rows };
  });

  app.post('/products', {
    preHandler: [requireAuth, requireCsrf, requireRoles(inventoryRoles)]
  }, async (request, reply) => {
    const payload = validate(productSchema, request.body);
    const product = await app.db.transaction(async transaction => {
      const result = await transaction.query(
        `INSERT INTO products (organization_id, name, sku, quantity, minimum_quantity)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, sku, quantity, minimum_quantity AS "minimumQuantity", created_at AS "createdAt"`,
        [request.auth.organization.id, payload.name, payload.sku || null, payload.quantity, payload.minimumQuantity]
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
        await transaction.query(
          `INSERT INTO notifications (organization_id, category, title, message)
           VALUES ($1, 'stock', $2, $3)`,
          [
            request.auth.organization.id,
            'Alerta de estoque crítico',
            `${created.name} está com ${created.quantity} unidade(s) em estoque.`
          ]
        );
      }
      await recordAudit(transaction, {
        organizationId: request.auth.organization.id,
        actorUserId: request.auth.id,
        action: 'stock.product_created',
        entityType: 'product',
        entityId: created.id,
        metadata: { quantity: created.quantity, minimumQuantity: created.minimumQuantity }
      });
      return created;
    });
    return reply.code(201).send({ product });
  });
};
