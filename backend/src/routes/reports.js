import { z } from 'zod';
import { AppError } from '../errors.js';
import { recordAudit } from '../audit.js';
import { requireAccountAccess, requireAuth } from '../auth/middleware.js';
import { dateSchema, validate } from './validation.js';

const maximumReportRows = 10000;
const reports = ['sales', 'stock', 'expenses', 'receivables'];
const reportParamsSchema = z.object({ report: z.enum(reports) });
const periodSchema = z.object({
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional()
}).superRefine((value, context) => {
  if (value.startDate && value.endDate && value.startDate > value.endDate) {
    context.addIssue({ code: 'custom', path: ['endDate'], message: 'O fim do período deve ser igual ou posterior ao início.' });
  }
});

const reportRoles = {
  sales: ['owner', 'admin', 'finance', 'operator'],
  stock: ['owner', 'admin', 'inventory', 'operator'],
  expenses: ['owner', 'admin', 'finance'],
  receivables: ['owner', 'admin', 'finance']
};

const paymentMethodLabels = {
  pix: 'Pix',
  card: 'Cartão',
  cash: 'Dinheiro',
  boleto: 'Boleto',
  bank_transfer: 'Transferência',
  other: 'Outros'
};
const movementLabels = {
  initial: 'Saldo inicial',
  entry: 'Entrada',
  exit: 'Saída',
  adjustment: 'Ajuste'
};

const csvCell = value => {
  const raw = value === null || value === undefined ? '' : String(value);
  const normalized = raw.replace(/[\r\n]+/g, ' ');
  const formulaSafe = /^[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
};

const toCsv = (header, rows) => `\uFEFF${[header, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
const cents = value => (Number(value || 0) / 100).toFixed(2).replace('.', ',');
const dateRange = (column, period, values, { timestamp = false } = {}) => {
  const clauses = [];
  if (period.startDate) {
    values.push(period.startDate);
    clauses.push(timestamp
      ? `${column} >= ($${values.length}::date AT TIME ZONE 'America/Sao_Paulo')`
      : `${column} >= $${values.length}::date`);
  }
  if (period.endDate) {
    values.push(period.endDate);
    clauses.push(timestamp
      ? `${column} < (($${values.length}::date + 1) AT TIME ZONE 'America/Sao_Paulo')`
      : `${column} <= $${values.length}::date`);
  }
  return clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
};

const assertReportSize = rows => {
  if (rows.length > maximumReportRows) {
    throw new AppError('O relatório possui mais de 10.000 linhas. Selecione um período menor para exportar.', {
      statusCode: 413,
      code: 'REPORT_TOO_LARGE'
    });
  }
};

const loadSales = async (db, organizationId, period) => {
  const values = [organizationId];
  const result = await db.query(
    `SELECT to_char(s.created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS "orderDate",
            s.order_number AS "orderNumber", customer.name AS "customerName", s.payment_method AS "paymentMethod",
            s.payment_status AS "paymentStatus", to_char(s.due_date, 'DD/MM/YYYY') AS "dueDate", s.total_cents AS "totalCents"
       FROM sales s
       JOIN customers customer ON customer.id = s.customer_id AND customer.organization_id = s.organization_id
      WHERE s.organization_id = $1${dateRange('s.created_at', period, values, { timestamp: true })}
      ORDER BY s.created_at DESC
      LIMIT ${maximumReportRows + 1}`,
    values
  );
  assertReportSize(result.rows);
  return {
    header: ['Data do pedido', 'Pedido', 'Cliente', 'Forma de pagamento', 'Situação', 'Vencimento', 'Total (R$)'],
    rows: result.rows.map(row => [
      row.orderDate,
      `#${row.orderNumber}`,
      row.customerName,
      paymentMethodLabels[row.paymentMethod] || row.paymentMethod,
      row.paymentStatus === 'paid' ? 'Recebido' : 'A prazo',
      row.dueDate || '',
      cents(row.totalCents)
    ])
  };
};

const loadStock = async (db, organizationId, period) => {
  const values = [organizationId];
  const result = await db.query(
    `SELECT to_char(movement.created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS "movementDate",
            product.name AS "productName", product.sku, movement.movement_type AS "movementType",
            movement.quantity_delta AS "quantityDelta", product.quantity AS "currentQuantity",
            product.minimum_quantity AS "minimumQuantity", movement.note
       FROM stock_movements movement
       JOIN products product ON product.id = movement.product_id AND product.organization_id = movement.organization_id
      WHERE movement.organization_id = $1${dateRange('movement.created_at', period, values, { timestamp: true })}
      ORDER BY movement.created_at DESC
      LIMIT ${maximumReportRows + 1}`,
    values
  );
  assertReportSize(result.rows);
  return {
    header: ['Data', 'Produto', 'SKU', 'Movimentação', 'Variação', 'Estoque atual', 'Estoque mínimo', 'Observação'],
    rows: result.rows.map(row => [
      row.movementDate,
      row.productName,
      row.sku || '',
      movementLabels[row.movementType] || row.movementType,
      row.quantityDelta,
      row.currentQuantity,
      row.minimumQuantity,
      row.note || ''
    ])
  };
};

const loadExpenses = async (db, organizationId, period) => {
  const values = [organizationId];
  const result = await db.query(
    `SELECT to_char(expense.due_date, 'DD/MM/YYYY') AS "dueDate", to_char(expense.issue_date, 'DD/MM/YYYY') AS "issueDate",
            expense.supplier_name AS "supplierName", expense.document_number AS "documentNumber", expense.category,
            expense.description, expense.amount_cents AS "amountCents", expense.status,
            COALESCE((SELECT string_agg(item->>'description', ', ')
                        FROM jsonb_array_elements(expense.invoice_items) AS item), '') AS "invoiceItems"
       FROM expenses expense
      WHERE expense.organization_id = $1${dateRange('expense.due_date', period, values)}
      ORDER BY expense.due_date DESC
      LIMIT ${maximumReportRows + 1}`,
    values
  );
  assertReportSize(result.rows);
  return {
    header: ['Vencimento', 'Emissão', 'Fornecedor', 'Nota fiscal', 'Categoria', 'Descrição', 'Valor (R$)', 'Status', 'Itens da NF-e'],
    rows: result.rows.map(row => [
      row.dueDate,
      row.issueDate || '',
      row.supplierName,
      row.documentNumber || '',
      row.category,
      row.description,
      cents(row.amountCents),
      row.status,
      row.invoiceItems
    ])
  };
};

const loadReceivables = async (db, organizationId, period) => {
  const values = [organizationId];
  const result = await db.query(
    `SELECT customer.name AS "customerName", sale.order_number AS "orderNumber", receivable.amount_cents AS "amountCents",
            to_char(receivable.due_date, 'DD/MM/YYYY') AS "dueDate", receivable.status,
            to_char(receivable.paid_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS "paidAt",
            CASE
              WHEN receivable.status = 'paid' THEN 'Pago'
              WHEN receivable.due_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'Atrasado'
              ELSE 'A vencer'
            END AS "displayStatus"
       FROM accounts_receivable receivable
       JOIN sales sale ON sale.id = receivable.sale_id AND sale.organization_id = receivable.organization_id
       JOIN customers customer ON customer.id = receivable.customer_id AND customer.organization_id = receivable.organization_id
      WHERE receivable.organization_id = $1${dateRange('receivable.due_date', period, values)}
      ORDER BY receivable.due_date DESC
      LIMIT ${maximumReportRows + 1}`,
    values
  );
  assertReportSize(result.rows);
  return {
    header: ['Cliente', 'Pedido', 'Vencimento', 'Valor (R$)', 'Status', 'Recebido em'],
    rows: result.rows.map(row => [
      row.customerName,
      `#${row.orderNumber}`,
      row.dueDate,
      cents(row.amountCents),
      row.displayStatus,
      row.paidAt || ''
    ])
  };
};

const loadReport = async (report, db, organizationId, period) => {
  if (report === 'sales') return loadSales(db, organizationId, period);
  if (report === 'stock') return loadStock(db, organizationId, period);
  if (report === 'expenses') return loadExpenses(db, organizationId, period);
  return loadReceivables(db, organizationId, period);
};

export const registerReportRoutes = async app => {
  app.get('/reports/:report.csv', {
    preHandler: [requireAuth, requireAccountAccess]
  }, async (request, reply) => {
    const { report } = validate(reportParamsSchema, request.params);
    const period = validate(periodSchema, request.query);
    if (!reportRoles[report].includes(request.auth.organization.role)) {
      throw new AppError('Você não tem permissão para exportar este relatório.', { statusCode: 403, code: 'FORBIDDEN' });
    }

    const csv = await request.tenantDb.transaction(async transaction => {
      const data = await loadReport(report, transaction, request.auth.organization.id, period);
      await recordAudit(transaction, {
        organizationId: request.auth.organization.id,
        actorUserId: request.auth.id,
        action: `reports.${report}_exported`,
        entityType: 'report',
        metadata: { startDate: period.startDate || null, endDate: period.endDate || null, rowCount: data.rows.length }
      });
      return toCsv(data.header, data.rows);
    });

    const suffix = period.startDate || period.endDate ? `-${period.startDate || 'inicio'}-${period.endDate || 'hoje'}` : '';
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="sev-${report}${suffix}.csv"`);
    reply.header('Cache-Control', 'no-store');
    return csv;
  });
};
