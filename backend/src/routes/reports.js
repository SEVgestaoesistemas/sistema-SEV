import { z } from 'zod';
import { AppError } from '../errors.js';
import { recordAudit } from '../audit.js';
import { requireAccountAccess, requireAuth } from '../auth/middleware.js';
import { createXlsxReport } from '../reports/xlsx.js';
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
  sales: ['owner', 'admin', 'operator'],
  stock: ['owner', 'admin', 'finance', 'inventory', 'operator'],
  expenses: ['owner', 'admin', 'finance'],
  receivables: ['owner', 'admin', 'finance']
};
const reportFileLabels = {
  sales: 'vendas',
  stock: 'estoque',
  expenses: 'despesas',
  receivables: 'contas-a-receber'
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
const expenseStatusLabels = {
  pending: 'Pendente',
  paid: 'Paga',
  overdue: 'Em atraso',
  cancelled: 'Cancelada'
};

const asCurrency = value => Number(value || 0) / 100;
const asTimestamp = value => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const asDateOnly = value => {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return asTimestamp(value);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
};
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
    `SELECT s.created_at AS "orderDate", s.order_number AS "orderNumber", customer.name AS "customerName",
            s.payment_method AS "paymentMethod", s.payment_status AS "paymentStatus", s.due_date AS "dueDate",
            s.total_cents AS "totalCents"
       FROM sales s
       JOIN customers customer ON customer.id = s.customer_id AND customer.organization_id = s.organization_id
      WHERE s.organization_id = $1${dateRange('s.created_at', period, values, { timestamp: true })}
      ORDER BY s.created_at DESC
      LIMIT ${maximumReportRows + 1}`,
    values
  );
  assertReportSize(result.rows);
  return {
    title: 'Relatório de Vendas',
    sheetName: 'Vendas',
    columns: [
      { header: 'Data do pedido', type: 'datetime', minWidth: 20 },
      { header: 'Pedido', type: 'integer', minWidth: 12 },
      { header: 'Cliente', type: 'text', minWidth: 20, maxWidth: 36, wrapText: true },
      { header: 'Forma de pagamento', type: 'text', minWidth: 20 },
      { header: 'Situação', type: 'text', minWidth: 14 },
      { header: 'Vencimento', type: 'date', minWidth: 14 },
      { header: 'Total', type: 'currency', minWidth: 16 }
    ],
    rows: result.rows.map(row => [
      asTimestamp(row.orderDate),
      Number(row.orderNumber),
      row.customerName,
      paymentMethodLabels[row.paymentMethod] || row.paymentMethod,
      row.paymentStatus === 'paid' ? 'Recebido' : 'A prazo',
      asDateOnly(row.dueDate),
      asCurrency(row.totalCents)
    ])
  };
};

const loadStock = async (db, organizationId, period) => {
  const values = [organizationId];
  const result = await db.query(
    `SELECT movement.created_at AS "movementDate", product.name AS "productName", product.sku,
            movement.movement_type AS "movementType", movement.quantity_delta AS "quantityDelta",
            product.quantity AS "currentQuantity", product.minimum_quantity AS "minimumQuantity", movement.note
       FROM stock_movements movement
       JOIN products product ON product.id = movement.product_id AND product.organization_id = movement.organization_id
      WHERE movement.organization_id = $1${dateRange('movement.created_at', period, values, { timestamp: true })}
      ORDER BY movement.created_at DESC
      LIMIT ${maximumReportRows + 1}`,
    values
  );
  assertReportSize(result.rows);
  return {
    title: 'Relatório de Estoque',
    sheetName: 'Estoque',
    columns: [
      { header: 'Data', type: 'datetime', minWidth: 20 },
      { header: 'Produto', type: 'text', minWidth: 20, maxWidth: 36, wrapText: true },
      { header: 'SKU', type: 'text', minWidth: 14 },
      { header: 'Movimentação', type: 'text', minWidth: 16 },
      { header: 'Variação', type: 'integer', minWidth: 12 },
      { header: 'Estoque atual', type: 'integer', minWidth: 15 },
      { header: 'Estoque mínimo', type: 'integer', minWidth: 16 },
      { header: 'Observação', type: 'text', minWidth: 18, maxWidth: 46, wrapText: true }
    ],
    rows: result.rows.map(row => [
      asTimestamp(row.movementDate),
      row.productName,
      row.sku || '',
      movementLabels[row.movementType] || row.movementType,
      Number(row.quantityDelta),
      Number(row.currentQuantity),
      Number(row.minimumQuantity),
      row.note || ''
    ])
  };
};

const loadExpenses = async (db, organizationId, period) => {
  const values = [organizationId];
  const result = await db.query(
    `SELECT expense.due_date AS "dueDate", expense.issue_date AS "issueDate", expense.supplier_name AS "supplierName",
            expense.document_number AS "documentNumber", expense.category, expense.description,
            expense.amount_cents AS "amountCents", expense.status,
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
    title: 'Relatório de Despesas',
    sheetName: 'Despesas',
    columns: [
      { header: 'Vencimento', type: 'date', minWidth: 14 },
      { header: 'Emissão', type: 'date', minWidth: 14 },
      { header: 'Fornecedor', type: 'text', minWidth: 20, maxWidth: 36, wrapText: true },
      { header: 'Nota fiscal', type: 'text', minWidth: 14 },
      { header: 'Categoria', type: 'text', minWidth: 14 },
      { header: 'Descrição', type: 'text', minWidth: 20, maxWidth: 46, wrapText: true },
      { header: 'Valor', type: 'currency', minWidth: 16 },
      { header: 'Status', type: 'text', minWidth: 14 },
      { header: 'Itens da NF-e', type: 'text', minWidth: 20, maxWidth: 50, wrapText: true }
    ],
    rows: result.rows.map(row => [
      asDateOnly(row.dueDate),
      asDateOnly(row.issueDate),
      row.supplierName,
      row.documentNumber || '',
      row.category,
      row.description,
      asCurrency(row.amountCents),
      expenseStatusLabels[row.status] || row.status,
      row.invoiceItems
    ])
  };
};

const loadReceivables = async (db, organizationId, period) => {
  const values = [organizationId];
  const result = await db.query(
    `SELECT customer.name AS "customerName", sale.order_number AS "orderNumber", receivable.amount_cents AS "amountCents",
            receivable.due_date AS "dueDate", receivable.status, receivable.paid_at AS "paidAt",
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
    title: 'Relatório de Contas a Receber',
    sheetName: 'Contas a Receber',
    columns: [
      { header: 'Cliente', type: 'text', minWidth: 20, maxWidth: 36, wrapText: true },
      { header: 'Pedido', type: 'integer', minWidth: 12 },
      { header: 'Vencimento', type: 'date', minWidth: 14 },
      { header: 'Valor', type: 'currency', minWidth: 16 },
      { header: 'Status', type: 'text', minWidth: 14 },
      { header: 'Recebido em', type: 'datetime', minWidth: 20 }
    ],
    rows: result.rows.map(row => [
      row.customerName,
      Number(row.orderNumber),
      asDateOnly(row.dueDate),
      asCurrency(row.amountCents),
      row.displayStatus,
      asTimestamp(row.paidAt)
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
  app.get('/reports/:report.xlsx', {
    preHandler: [requireAuth, requireAccountAccess]
  }, async (request, reply) => {
    const { report } = validate(reportParamsSchema, request.params);
    const period = validate(periodSchema, request.query);
    if (!reportRoles[report].includes(request.auth.organization.role)) {
      throw new AppError('Você não tem permissão para exportar este relatório.', { statusCode: 403, code: 'FORBIDDEN' });
    }

    const data = await request.tenantDb.transaction(async transaction => {
      const reportData = await loadReport(report, transaction, request.auth.organization.id, period);
      await recordAudit(transaction, {
        organizationId: request.auth.organization.id,
        actorUserId: request.auth.id,
        action: `reports.${report}_exported`,
        entityType: 'report',
        metadata: { format: 'xlsx', startDate: period.startDate || null, endDate: period.endDate || null, rowCount: reportData.rows.length }
      });
      return reportData;
    });

    const suffix = period.startDate || period.endDate ? `-${period.startDate || 'inicio'}-a-${period.endDate || 'hoje'}` : '-todos-os-periodos';
    const fileName = `sev-relatorio-${reportFileLabels[report]}${suffix}.xlsx`;
    const xlsx = await createXlsxReport({ ...data, period });
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
    reply.header('Content-Length', String(xlsx.length));
    reply.header('Cache-Control', 'no-store');
    return xlsx;
  });
};
