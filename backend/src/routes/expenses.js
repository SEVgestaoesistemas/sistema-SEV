import { z } from 'zod';
import { recordAudit } from '../audit.js';
import { requireAccountAccess, requireAuth, requireCsrf, requireRoles } from '../auth/middleware.js';
import { dateSchema, validate } from './validation.js';

const normalizeDigits = value => value ? value.replace(/\D/g, '') || null : null;
const optionalText = maximum => z.string().trim().max(maximum).optional().transform(value => value || null);
const financeRoles = ['owner', 'admin', 'finance'];

const expenseSchema = z.object({
  supplierName: z.string().trim().min(3).max(140),
  supplierCnpj: optionalText(18),
  documentNumber: optionalText(60),
  documentKey: optionalText(44),
  issueDate: dateSchema.optional(),
  dueDate: dateSchema,
  category: z.string().trim().min(2).max(80),
  description: z.string().trim().min(3).max(240),
  amountCents: z.coerce.number().int().min(1).max(1000000000000),
  documentFileName: optionalText(255)
}).superRefine((value, context) => {
  const cnpj = normalizeDigits(value.supplierCnpj);
  if (cnpj && cnpj.length !== 14) {
    context.addIssue({ code: 'custom', path: ['supplierCnpj'], message: 'CNPJ inválido.' });
  }
  if (value.documentKey && !/^\d{44}$/.test(value.documentKey)) {
    context.addIssue({ code: 'custom', path: ['documentKey'], message: 'Chave de acesso inválida.' });
  }
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['pending', 'paid', 'overdue', 'cancelled']).optional()
});

export const registerExpenseRoutes = async app => {
  app.get('/expenses', { preHandler: [requireAuth, requireAccountAccess, requireRoles(financeRoles)] }, async request => {
    const query = validate(listQuerySchema, request.query);
    const values = [request.auth.organization.id, query.limit];
    const statusCondition = query.status ? 'AND status = $3' : '';
    if (query.status) values.push(query.status);
    const result = await request.tenantDb.query(
      `SELECT id, supplier_name AS "supplierName", supplier_cnpj AS "supplierCnpj", document_number AS "documentNumber",
              issue_date AS "issueDate", due_date AS "dueDate", category, description, amount_cents AS "amountCents",
              status, document_file_name AS "documentFileName", created_at AS "createdAt"
         FROM expenses
        WHERE organization_id = $1 ${statusCondition}
        ORDER BY due_date DESC
        LIMIT $2`,
      values
    );
    return { expenses: result.rows.map(expense => ({ ...expense, amountCents: Number(expense.amountCents) })) };
  });

  app.post('/expenses', {
    preHandler: [requireAuth, requireCsrf, requireAccountAccess, requireRoles(financeRoles)]
  }, async (request, reply) => {
    const payload = validate(expenseSchema, request.body);
    const expense = await request.tenantDb.transaction(async transaction => {
      const result = await transaction.query(
        `INSERT INTO expenses (
           organization_id, supplier_name, supplier_cnpj, document_number, document_key, issue_date,
           due_date, category, description, amount_cents, document_file_name
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, supplier_name AS "supplierName", supplier_cnpj AS "supplierCnpj", document_number AS "documentNumber",
                   issue_date AS "issueDate", due_date AS "dueDate", category, description, amount_cents AS "amountCents",
                   status, document_file_name AS "documentFileName", created_at AS "createdAt"`,
        [
          request.auth.organization.id,
          payload.supplierName,
          normalizeDigits(payload.supplierCnpj),
          payload.documentNumber,
          payload.documentKey,
          payload.issueDate || null,
          payload.dueDate,
          payload.category,
          payload.description,
          payload.amountCents,
          payload.documentFileName
        ]
      );
      const created = result.rows[0];
      await recordAudit(transaction, {
        organizationId: request.auth.organization.id,
        actorUserId: request.auth.id,
        action: 'finance.expense_created',
        entityType: 'expense',
        entityId: created.id,
        metadata: { amountCents: Number(created.amountCents), category: created.category }
      });
      return { ...created, amountCents: Number(created.amountCents) };
    });
    return reply.code(201).send({ expense });
  });
};
