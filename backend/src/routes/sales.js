import { z } from 'zod';
import { AppError } from '../errors.js';
import { recordAudit } from '../audit.js';
import { requireAccountAccess, requireAuth, requireCsrf, requireRoles } from '../auth/middleware.js';
import { dateSchema, emailSchema, validate } from './validation.js';

const commercialReadRoles = ['owner', 'admin', 'operator', 'finance', 'inventory'];
const commercialWriteRoles = ['owner', 'admin', 'operator'];
const financeRoles = ['owner', 'admin', 'finance'];
const maximumSaleCents = 1000000000000n;
const paymentMethods = ['pix', 'card', 'cash', 'boleto', 'bank_transfer', 'other'];

const optionalText = maximum => z.string().trim().max(maximum).optional().transform(value => value || null);
const optionalEmail = z.union([emailSchema, z.literal('')]).optional().transform(value => value || null);
const normalizeDigits = value => value ? value.replace(/\D/g, '') || null : null;
const moneyNumber = value => Number(value || 0);

const customerSchema = z.object({
  name: z.string().trim().min(3).max(140),
  document: optionalText(18),
  email: optionalEmail,
  phone: optionalText(24),
  notes: optionalText(500)
}).superRefine((value, context) => {
  const document = normalizeDigits(value.document);
  if (document && ![11, 14].includes(document.length)) {
    context.addIssue({ code: 'custom', path: ['document'], message: 'Informe um CPF ou CNPJ válido.' });
  }
});

const customerQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  search: z.string().trim().max(140).optional()
});

const saleItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(100000000),
  unitPriceCents: z.coerce.number().int().min(1).max(Number(maximumSaleCents))
});

const saleSchema = z.object({
  customerId: z.string().uuid(),
  paymentMethod: z.enum(paymentMethods),
  paymentStatus: z.enum(['paid', 'pending']),
  dueDate: dateSchema.optional(),
  items: z.array(saleItemSchema).min(1).max(100)
}).superRefine((value, context) => {
  if (value.paymentStatus === 'pending' && !value.dueDate) {
    context.addIssue({ code: 'custom', path: ['dueDate'], message: 'Informe o vencimento para uma venda a prazo.' });
  }
  if (value.paymentStatus === 'paid' && value.dueDate) {
    context.addIssue({ code: 'custom', path: ['dueDate'], message: 'Venda recebida não deve ter vencimento.' });
  }
});

const saleQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  paymentStatus: z.enum(['paid', 'pending']).optional()
});

const publicCustomer = row => ({
  id: row.id,
  name: row.name,
  document: row.document || null,
  email: row.email || null,
  phone: row.phone || null,
  notes: row.notes || null,
  createdAt: row.createdAt
});

const publicSale = (row, { redactFinancialValues = false } = {}) => ({
  id: row.id,
  orderNumber: Number(row.orderNumber),
  customerId: row.customerId,
  customerName: row.customerName,
  paymentMethod: row.paymentMethod,
  paymentStatus: row.paymentStatus,
  dueDate: row.dueDate || null,
  ...(redactFinancialValues
    ? { financialValuesRedacted: true }
    : { totalCents: moneyNumber(row.totalCents), financialValuesRedacted: false }),
  itemCount: Number(row.itemCount || 0),
  createdAt: row.createdAt
});

const redactFinancialDashboard = dashboard => ({
  financialValuesRedacted: true,
  summary: {
    ...dashboard.summary,
    revenueCents: null,
    averageTicketCents: null,
    pendingCents: null
  },
  monthly: dashboard.monthly.map(month => ({
    ...month,
    revenueCents: null,
    expenseCents: null
  })),
  paymentMethods: dashboard.paymentMethods.map(payment => ({
    paymentMethod: payment.paymentMethod,
    orderCount: payment.orderCount,
    financialValuesRedacted: true
  })),
  recentSales: dashboard.recentSales.map(sale => publicSale(sale, { redactFinancialValues: true }))
});

const validateSaleTotal = items => {
  let total = 0n;
  for (const item of items) {
    total += BigInt(item.quantity) * BigInt(item.unitPriceCents);
    if (total > maximumSaleCents) {
      throw new AppError('O total do pedido excede o limite permitido.', { statusCode: 400, code: 'SALE_TOTAL_INVALID' });
    }
  }
  return Number(total);
};

const assertUniqueProducts = items => {
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.productId)) {
      throw new AppError('Cada produto deve aparecer apenas uma vez no pedido.', { statusCode: 400, code: 'DUPLICATE_SALE_PRODUCT' });
    }
    ids.add(item.productId);
  }
};

const loadDashboard = async (db, organizationId) => {
  const [summaryResult, financialResult, stockResult, monthlyResult, paymentResult, recentResult] = await Promise.all([
    db.query(
      `SELECT
         COALESCE(SUM(total_cents) FILTER (WHERE payment_status = 'paid'), 0) AS "revenueCents",
         COUNT(*) AS "orderCount",
         COALESCE(AVG(total_cents), 0) AS "averageTicketCents",
         COALESCE(SUM(total_cents) FILTER (WHERE payment_status = 'pending'), 0) AS "pendingCents"
       FROM sales
      WHERE organization_id = $1
        AND created_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')`,
      [organizationId]
    ),
    db.query(
      `SELECT
         COALESCE((
           SELECT SUM(total_cents)
             FROM sales
            WHERE organization_id = $1 AND payment_status = 'paid'
         ), 0) AS "revenueCents",
         COALESCE((
           SELECT SUM(amount_cents)
             FROM expenses
            WHERE organization_id = $1 AND status <> 'cancelled'
         ), 0) AS "expenseCents"`,
      [organizationId]
    ),
    db.query(
      `SELECT COUNT(*) AS "productCount", COALESCE(SUM(quantity), 0) AS "unitsInStock",
              COUNT(*) FILTER (WHERE quantity = 0) AS "outOfStockCount",
              COUNT(*) FILTER (WHERE quantity > 0 AND quantity <= minimum_quantity) AS "lowStockCount"
         FROM products
        WHERE organization_id = $1`,
      [organizationId]
    ),
    db.query(
      `WITH months AS (
         SELECT generate_series(
           date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - interval '5 months',
           date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'),
           interval '1 month'
         ) AS month_start
       )
       SELECT to_char(month_start, 'YYYY-MM') AS month,
              COALESCE((
                SELECT SUM(s.total_cents) FROM sales s
                 WHERE s.organization_id = $1 AND s.payment_status = 'paid'
                   AND s.created_at >= month_start AND s.created_at < month_start + interval '1 month'
              ), 0) AS "revenueCents",
              COALESCE((
                SELECT COUNT(*) FROM sales s
                 WHERE s.organization_id = $1
                   AND s.created_at >= month_start AND s.created_at < month_start + interval '1 month'
              ), 0) AS "orderCount",
              COALESCE((
                SELECT SUM(e.amount_cents) FROM expenses e
                 WHERE e.organization_id = $1 AND e.status <> 'cancelled'
                   AND e.due_date >= month_start::date AND e.due_date < (month_start + interval '1 month')::date
              ), 0) AS "expenseCents"
         FROM months
        ORDER BY month_start`,
      [organizationId]
    ),
    db.query(
      `SELECT payment_method AS "paymentMethod", COALESCE(SUM(total_cents), 0) AS "totalCents", COUNT(*) AS "orderCount"
         FROM sales
        WHERE organization_id = $1
        GROUP BY payment_method
        ORDER BY "totalCents" DESC`,
      [organizationId]
    ),
    db.query(
      `SELECT s.id, s.order_number AS "orderNumber", s.customer_id AS "customerId", c.name AS "customerName",
              s.payment_method AS "paymentMethod", s.payment_status AS "paymentStatus", s.due_date AS "dueDate",
              s.total_cents AS "totalCents", s.created_at AS "createdAt", COUNT(item.id) AS "itemCount"
         FROM sales s
         JOIN customers c ON c.id = s.customer_id AND c.organization_id = s.organization_id
         LEFT JOIN sale_items item ON item.sale_id = s.id AND item.organization_id = s.organization_id
        WHERE s.organization_id = $1
        GROUP BY s.id, c.name
        ORDER BY s.created_at DESC
        LIMIT 8`,
      [organizationId]
    )
  ]);

  const summary = summaryResult.rows[0];
  const financial = financialResult.rows[0];
  const revenueCents = moneyNumber(financial.revenueCents);
  const expenseCents = moneyNumber(financial.expenseCents);
  const stock = stockResult.rows[0];
  return {
    financialSummary: {
      revenueCents,
      expenseCents,
      balanceCents: revenueCents - expenseCents
    },
    summary: {
      revenueCents: moneyNumber(summary.revenueCents),
      orderCount: Number(summary.orderCount),
      averageTicketCents: moneyNumber(summary.averageTicketCents),
      pendingCents: moneyNumber(summary.pendingCents),
      productCount: Number(stock.productCount),
      unitsInStock: Number(stock.unitsInStock),
      outOfStockCount: Number(stock.outOfStockCount),
      lowStockCount: Number(stock.lowStockCount)
    },
    monthly: monthlyResult.rows.map(row => ({
      month: row.month,
      revenueCents: moneyNumber(row.revenueCents),
      expenseCents: moneyNumber(row.expenseCents),
      orderCount: Number(row.orderCount)
    })),
    paymentMethods: paymentResult.rows.map(row => ({
      paymentMethod: row.paymentMethod,
      totalCents: moneyNumber(row.totalCents),
      orderCount: Number(row.orderCount)
    })),
    recentSales: recentResult.rows.map(publicSale)
  };
};

export const registerSalesRoutes = async app => {
  app.get('/customers', { preHandler: [requireAuth, requireAccountAccess, requireRoles(commercialReadRoles)] }, async request => {
    const query = validate(customerQuerySchema, request.query);
    const values = [request.auth.organization.id, query.limit];
    const searchCondition = query.search ? 'AND (name ILIKE $3 OR email ILIKE $3 OR document ILIKE $3)' : '';
    if (query.search) values.push(`%${query.search}%`);
    const result = await request.tenantDb.query(
      `SELECT id, name, document, email, phone, notes, created_at AS "createdAt"
         FROM customers
        WHERE organization_id = $1 AND is_active = true ${searchCondition}
        ORDER BY name ASC
        LIMIT $2`,
      values
    );
    return { customers: result.rows.map(publicCustomer) };
  });

  app.post('/customers', {
    preHandler: [requireAuth, requireCsrf, requireAccountAccess, requireRoles(commercialWriteRoles)]
  }, async (request, reply) => {
    const payload = validate(customerSchema, request.body);
    const customer = await request.tenantDb.transaction(async transaction => {
      const result = await transaction.query(
        `INSERT INTO customers (organization_id, name, document, email, phone, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, document, email, phone, notes, created_at AS "createdAt"`,
        [
          request.auth.organization.id,
          payload.name,
          normalizeDigits(payload.document),
          payload.email,
          payload.phone,
          payload.notes
        ]
      );
      const created = publicCustomer(result.rows[0]);
      await recordAudit(transaction, {
        organizationId: request.auth.organization.id,
        actorUserId: request.auth.id,
        action: 'sales.customer_created',
        entityType: 'customer',
        entityId: created.id
      });
      return created;
    });
    return reply.code(201).send({ customer });
  });

  app.get('/sales/dashboard', { preHandler: [requireAuth, requireAccountAccess, requireRoles(commercialReadRoles)] }, async request => {
    const dashboard = await loadDashboard(request.tenantDb, request.auth.organization.id);
    return { dashboard: request.auth.organization.role === 'finance' ? redactFinancialDashboard(dashboard) : dashboard };
  });

  app.get('/finance/dashboard', {
    preHandler: [requireAuth, requireAccountAccess, requireRoles(financeRoles)]
  }, async request => ({ dashboard: await loadDashboard(request.tenantDb, request.auth.organization.id) }));

  app.get('/dashboard/overview', { preHandler: [requireAuth, requireAccountAccess] }, async request => {
    const dashboard = await loadDashboard(request.tenantDb, request.auth.organization.id);
    return { dashboard: request.auth.organization.role === 'finance' ? redactFinancialDashboard(dashboard) : dashboard };
  });

  app.get('/sales', { preHandler: [requireAuth, requireAccountAccess, requireRoles(commercialReadRoles)] }, async request => {
    const query = validate(saleQuerySchema, request.query);
    const values = [request.auth.organization.id, query.limit];
    const statusCondition = query.paymentStatus ? 'AND s.payment_status = $3' : '';
    if (query.paymentStatus) values.push(query.paymentStatus);
    const result = await request.tenantDb.query(
      `SELECT s.id, s.order_number AS "orderNumber", s.customer_id AS "customerId", c.name AS "customerName",
              s.payment_method AS "paymentMethod", s.payment_status AS "paymentStatus", s.due_date AS "dueDate",
              s.total_cents AS "totalCents", s.created_at AS "createdAt", COUNT(item.id) AS "itemCount"
         FROM sales s
         JOIN customers c ON c.id = s.customer_id AND c.organization_id = s.organization_id
         LEFT JOIN sale_items item ON item.sale_id = s.id AND item.organization_id = s.organization_id
        WHERE s.organization_id = $1 ${statusCondition}
        GROUP BY s.id, c.name
        ORDER BY s.created_at DESC
        LIMIT $2`,
      values
    );
    const redactFinancialValues = request.auth.organization.role === 'finance';
    return { sales: result.rows.map(row => publicSale(row, { redactFinancialValues })) };
  });

  app.post('/sales', {
    preHandler: [requireAuth, requireCsrf, requireAccountAccess, requireRoles(commercialWriteRoles)]
  }, async (request, reply) => {
    const payload = validate(saleSchema, request.body);
    assertUniqueProducts(payload.items);
    const totalCents = validateSaleTotal(payload.items);

    const sale = await request.tenantDb.transaction(async transaction => {
      const customer = await transaction.query(
        'SELECT id, name FROM customers WHERE id = $1 AND organization_id = $2 AND is_active = true FOR SHARE',
        [payload.customerId, request.auth.organization.id]
      );
      if (!customer.rowCount) {
        throw new AppError('Cliente ou produto não pertence a esta empresa.', { statusCode: 400, code: 'SALES_REFERENCE_INVALID' });
      }

      const productIds = payload.items.map(item => item.productId);
      const productsResult = await transaction.query(
        `SELECT id, name, quantity, minimum_quantity AS "minimumQuantity"
           FROM products
          WHERE organization_id = $1 AND id = ANY($2::uuid[])
          FOR UPDATE`,
        [request.auth.organization.id, productIds]
      );
      if (productsResult.rowCount !== productIds.length) {
        throw new AppError('Cliente ou produto não pertence a esta empresa.', { statusCode: 400, code: 'SALES_REFERENCE_INVALID' });
      }
      const products = new Map(productsResult.rows.map(product => [product.id, product]));
      for (const item of payload.items) {
        const product = products.get(item.productId);
        if (product.quantity < item.quantity) {
          throw new AppError(`Estoque insuficiente para ${product.name}.`, { statusCode: 409, code: 'INSUFFICIENT_STOCK' });
        }
      }

      const saleResult = await transaction.query(
        `INSERT INTO sales (organization_id, customer_id, payment_method, payment_status, due_date, total_cents, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, order_number AS "orderNumber", customer_id AS "customerId", payment_method AS "paymentMethod",
                   payment_status AS "paymentStatus", due_date AS "dueDate", total_cents AS "totalCents", created_at AS "createdAt"`,
        [
          request.auth.organization.id,
          payload.customerId,
          payload.paymentMethod,
          payload.paymentStatus,
          payload.paymentStatus === 'pending' ? payload.dueDate : null,
          totalCents,
          request.auth.id
        ]
      );
      const created = saleResult.rows[0];
      const items = [];
      for (const item of payload.items) {
        const product = products.get(item.productId);
        const subtotalCents = Number(BigInt(item.quantity) * BigInt(item.unitPriceCents));
        const itemResult = await transaction.query(
          `INSERT INTO sale_items (organization_id, sale_id, product_id, product_name, quantity, unit_price_cents, subtotal_cents)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, product_id AS "productId", product_name AS "productName", quantity,
                     unit_price_cents AS "unitPriceCents", subtotal_cents AS "subtotalCents"`,
          [request.auth.organization.id, created.id, product.id, product.name, item.quantity, item.unitPriceCents, subtotalCents]
        );
        await transaction.query(
          `UPDATE products
              SET quantity = quantity - $3
            WHERE id = $1 AND organization_id = $2`,
          [product.id, request.auth.organization.id, item.quantity]
        );
        await transaction.query(
          `INSERT INTO stock_movements (organization_id, product_id, actor_user_id, movement_type, quantity_delta, note)
           VALUES ($1, $2, $3, 'exit', $4, $5)`,
          [request.auth.organization.id, product.id, request.auth.id, -item.quantity, `Pedido #${created.orderNumber}`]
        );
        const remainingQuantity = product.quantity - item.quantity;
        if (remainingQuantity <= product.minimumQuantity) {
          await transaction.query(
            `INSERT INTO notifications (organization_id, category, title, message)
             VALUES ($1, 'stock', $2, $3)`,
            [
              request.auth.organization.id,
              'Alerta de estoque crítico',
              `${product.name} está com ${remainingQuantity} unidade(s) após o pedido #${created.orderNumber}.`
            ]
          );
        }
        items.push({
          ...itemResult.rows[0],
          unitPriceCents: moneyNumber(itemResult.rows[0].unitPriceCents),
          subtotalCents: moneyNumber(itemResult.rows[0].subtotalCents)
        });
      }
      await recordAudit(transaction, {
        organizationId: request.auth.organization.id,
        actorUserId: request.auth.id,
        action: 'sales.order_created',
        entityType: 'sale',
        entityId: created.id,
        metadata: { orderNumber: Number(created.orderNumber), totalCents, itemCount: items.length, paymentStatus: created.paymentStatus }
      });
      return {
        ...publicSale({ ...created, customerName: customer.rows[0].name, itemCount: items.length }),
        items
      };
    });
    return reply.code(201).send({ sale });
  });
};
