import { z } from 'zod';
import { AppError } from '../errors.js';
import { recordAudit } from '../audit.js';
import { requireAccountAccess, requireAuth, requireCsrf, requireRoles } from '../auth/middleware.js';
import { validate } from './validation.js';

const financeRoles = ['owner', 'admin', 'finance'];
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['upcoming', 'overdue', 'paid']).optional()
});
const paramsSchema = z.object({ id: z.string().uuid() });
const moneyNumber = value => Number(value || 0);

const todayInBrazilSql = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";
const statusSql = `CASE
  WHEN receivable.status = 'paid' THEN 'paid'
  WHEN receivable.due_date < ${todayInBrazilSql} THEN 'overdue'
  ELSE 'upcoming'
END`;

const publicReceivable = row => ({
  id: row.id,
  saleId: row.saleId,
  orderNumber: Number(row.orderNumber),
  customerId: row.customerId,
  customerName: row.customerName,
  amountCents: moneyNumber(row.amountCents),
  dueDate: row.dueDate,
  status: row.status,
  paidAt: row.paidAt || null,
  createdAt: row.createdAt
});

const receivableSelect = `
  SELECT receivable.id,
         receivable.sale_id AS "saleId",
         sale.order_number AS "orderNumber",
         receivable.customer_id AS "customerId",
         customer.name AS "customerName",
         receivable.amount_cents AS "amountCents",
         receivable.due_date AS "dueDate",
         ${statusSql} AS status,
         receivable.paid_at AS "paidAt",
         receivable.created_at AS "createdAt"
    FROM accounts_receivable receivable
    JOIN sales sale
      ON sale.id = receivable.sale_id
     AND sale.organization_id = receivable.organization_id
    JOIN customers customer
      ON customer.id = receivable.customer_id
     AND customer.organization_id = receivable.organization_id`;

export const registerReceivableRoutes = async app => {
  app.get('/receivables', {
    preHandler: [requireAuth, requireAccountAccess, requireRoles(financeRoles)]
  }, async request => {
    const query = validate(listQuerySchema, request.query);
    const result = await request.tenantDb.query(
      `WITH visible_receivables AS (
         ${receivableSelect}
         WHERE receivable.organization_id = $1
       )
       SELECT *
         FROM visible_receivables
        WHERE ($2::text IS NULL OR status = $2)
        ORDER BY CASE WHEN status = 'paid' THEN 1 ELSE 0 END ASC,
                 "dueDate" ASC,
                 "createdAt" DESC
        LIMIT $3`,
      [request.auth.organization.id, query.status || null, query.limit]
    );
    return { receivables: result.rows.map(publicReceivable) };
  });

  app.get('/receivables/dashboard', {
    preHandler: [requireAuth, requireAccountAccess, requireRoles(financeRoles)]
  }, async request => {
    const [summaryResult, customerResult] = await Promise.all([
      request.tenantDb.query(
        `SELECT
           COALESCE(SUM(amount_cents) FILTER (WHERE status = 'pending'), 0) AS "pendingCents",
           COUNT(*) FILTER (WHERE status = 'pending') AS "pendingCount",
           COALESCE(SUM(amount_cents) FILTER (WHERE status = 'pending' AND due_date < ${todayInBrazilSql}), 0) AS "overdueCents",
           COUNT(*) FILTER (WHERE status = 'pending' AND due_date < ${todayInBrazilSql}) AS "overdueCount"
           FROM accounts_receivable
          WHERE organization_id = $1`,
        [request.auth.organization.id]
      ),
      request.tenantDb.query(
        `SELECT customer.name AS "customerName",
                COALESCE(SUM(receivable.amount_cents), 0) AS "amountCents",
                COUNT(*) AS "receivableCount"
           FROM accounts_receivable receivable
           JOIN customers customer
             ON customer.id = receivable.customer_id
            AND customer.organization_id = receivable.organization_id
          WHERE receivable.organization_id = $1
            AND receivable.status = 'pending'
          GROUP BY customer.id, customer.name
          ORDER BY "amountCents" DESC, customer.name ASC
          LIMIT 5`,
        [request.auth.organization.id]
      )
    ]);
    const summary = summaryResult.rows[0];
    return {
      dashboard: {
        pendingCents: moneyNumber(summary.pendingCents),
        pendingCount: Number(summary.pendingCount),
        overdueCents: moneyNumber(summary.overdueCents),
        overdueCount: Number(summary.overdueCount),
        customers: customerResult.rows.map(row => ({
          customerName: row.customerName,
          amountCents: moneyNumber(row.amountCents),
          receivableCount: Number(row.receivableCount)
        }))
      }
    };
  });

  app.patch('/receivables/:id/mark-paid', {
    preHandler: [requireAuth, requireCsrf, requireAccountAccess, requireRoles(financeRoles)]
  }, async request => {
    const { id } = validate(paramsSchema, request.params);
    const receivable = await request.tenantDb.transaction(async transaction => {
      const updated = await transaction.query(
        `UPDATE accounts_receivable
            SET status = 'paid', paid_at = now()
          WHERE id = $1
            AND organization_id = $2
            AND status = 'pending'
        RETURNING id, sale_id AS "saleId", customer_id AS "customerId", amount_cents AS "amountCents",
                  due_date AS "dueDate", status, paid_at AS "paidAt", created_at AS "createdAt"`,
        [id, request.auth.organization.id]
      );
      if (!updated.rowCount) {
        throw new AppError('Conta a receber não encontrada ou já foi baixada.', {
          statusCode: 404,
          code: 'RECEIVABLE_NOT_FOUND'
        });
      }

      const changed = updated.rows[0];
      const sale = await transaction.query(
        `UPDATE sales
            SET payment_status = 'paid', due_date = NULL
          WHERE id = $1 AND organization_id = $2
        RETURNING order_number AS "orderNumber"`,
        [changed.saleId, request.auth.organization.id]
      );
      if (!sale.rowCount) {
        throw new AppError('Venda vinculada não encontrada.', { statusCode: 409, code: 'SALE_NOT_FOUND' });
      }
      const customer = await transaction.query(
        'SELECT name AS "customerName" FROM customers WHERE id = $1 AND organization_id = $2',
        [changed.customerId, request.auth.organization.id]
      );
      if (!customer.rowCount) {
        throw new AppError('Cliente vinculado não encontrado.', { statusCode: 409, code: 'CUSTOMER_NOT_FOUND' });
      }

      const response = publicReceivable({
        ...changed,
        orderNumber: sale.rows[0].orderNumber,
        customerName: customer.rows[0].customerName,
        status: 'paid'
      });
      await recordAudit(transaction, {
        organizationId: request.auth.organization.id,
        actorUserId: request.auth.id,
        action: 'finance.receivable_paid',
        entityType: 'accounts_receivable',
        entityId: response.id,
        metadata: { saleId: response.saleId, orderNumber: response.orderNumber, amountCents: response.amountCents }
      });
      return response;
    });
    return { receivable };
  });
};
