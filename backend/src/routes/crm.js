import { z } from 'zod';
import { AppError } from '../errors.js';
import { recordAudit } from '../audit.js';
import { requireAccountAccess, requireAuth, requireCsrf, requireModule, requireRoles } from '../auth/middleware.js';
import { dateSchema, validate } from './validation.js';

const crmRoles = ['owner', 'admin', 'operator'];
const crmManagerRoles = ['owner', 'admin'];
const idSchema = z.object({ id: z.string().uuid() });
const taskIdSchema = z.object({ taskId: z.string().uuid() });
const itemIdSchema = z.object({ itemId: z.string().uuid() });
const text = maximum => z.string().trim().min(2).max(maximum);
const optionalText = maximum => z.union([z.string().trim().max(maximum), z.literal('')]).optional().transform(value => value || null);
const stageSchema = z.object({ nome: text(80), cor: z.string().regex(/^#[0-9A-Fa-f]{6}$/), ordem: z.coerce.number().int().min(1).max(100) });
const stageUpdateSchema = z.object({ nome: text(80).optional(), cor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(), ordem: z.coerce.number().int().min(1).max(100).optional() }).refine(value => Object.keys(value).length > 0);
const negotiationSchema = z.object({
  etapaId: z.string().uuid(), nome: text(160), valorCents: z.coerce.number().int().min(0).max(1000000000000).default(0),
  qualificacao: optionalText(240), fonte: optionalText(100), campanha: optionalText(140), responsavelId: z.union([z.string().uuid(), z.null()]).optional().default(null)
});
const negotiationUpdateSchema = z.object({
  nome: text(160).optional(), valorCents: z.coerce.number().int().min(0).max(1000000000000).optional(),
  qualificacao: optionalText(240), fonte: optionalText(100), campanha: optionalText(140), responsavelId: z.union([z.string().uuid(), z.null()]).optional()
}).refine(value => Object.keys(value).length > 0);
const stageMoveSchema = z.object({ etapaId: z.string().uuid() });
const taskSchema = z.object({ texto: text(500), prazo: z.union([dateSchema, z.null()]).optional().default(null) });
const taskUpdateSchema = z.object({ texto: text(500).optional(), feita: z.boolean().optional(), prazo: z.union([dateSchema, z.null()]).optional() }).refine(value => Object.keys(value).length > 0);
const proposalSchema = z.object({ nomeProduto: text(160), quantidade: z.coerce.number().int().min(1).max(100000000), precoCents: z.coerce.number().int().min(0).max(1000000000000) });
const proposalUpdateSchema = proposalSchema.partial().refine(value => Object.keys(value).length > 0);
const manualHistorySchema = z.object({ titulo: text(160), descricao: optionalText(1000) });
const groupedQuerySchema = z.object({ agrupado_por_etapa: z.enum(['true', 'false']).optional() });

const stagePublic = row => ({ id: row.id, name: row.nome, color: row.cor, order: Number(row.ordem) });
const negotiationPublic = row => ({
  id: row.id, stageId: row.etapaId, name: row.nome, valueCents: Number(row.valorCents), qualification: row.qualificacao || null,
  source: row.fonte || null, campaign: row.campanha || null, responsibleId: row.responsavelId || null,
  responsibleName: row.responsavelNome || null, createdAt: row.criadoEm, updatedAt: row.atualizadoEm
});
const taskPublic = row => ({ id: row.id, negotiationId: row.negociacaoId, text: row.texto, done: Boolean(row.feita), dueDate: row.prazo || null, createdAt: row.criadoEm });
const historyPublic = row => ({ id: row.id, negotiationId: row.negociacaoId, title: row.titulo, description: row.descricao || null, type: row.tipo, createdAt: row.criadoEm, createdBy: row.criadoPor || null, createdByName: row.criadoPorNome || null });
const proposalPublic = row => ({ id: row.id, negotiationId: row.negociacaoId, productName: row.nomeProduto, quantity: Number(row.quantidade), priceCents: Number(row.precoCents), totalCents: Number(row.quantidade) * Number(row.precoCents) });

const assertStage = async (db, organizationId, stageId) => {
  const stage = await db.query('SELECT id, nome FROM crm_etapas WHERE id = $1 AND organization_id = $2', [stageId, organizationId]);
  if (!stage.rowCount) throw new AppError('A etapa informada não pertence a esta empresa.', { statusCode: 400, code: 'CRM_STAGE_INVALID' });
  return stage.rows[0];
};
const assertResponsible = async (db, organizationId, userId) => {
  if (!userId) return null;
  const member = await db.query(
    `SELECT user_account.id, user_account.name FROM organization_memberships membership
      JOIN users user_account ON user_account.id = membership.user_id
     WHERE membership.organization_id = $1 AND membership.user_id = $2 AND user_account.is_active = true`, [organizationId, userId]
  );
  if (!member.rowCount) throw new AppError('O responsável precisa pertencer à empresa.', { statusCode: 400, code: 'CRM_RESPONSIBLE_INVALID' });
  return member.rows[0];
};
const assertNegotiation = async (db, organizationId, id, lock = false) => {
  const result = await db.query(
    `SELECT n.id, n.etapa_id AS "etapaId", n.nome, n.valor_cents AS "valorCents", n.qualificacao, n.fonte, n.campanha,
            n.responsavel_id AS "responsavelId", n.criado_em AS "criadoEm", n.atualizado_em AS "atualizadoEm",
            stage.nome AS "stageName", stage.cor AS "stageColor", user_account.name AS "responsavelNome"
       FROM crm_negociacoes n
       JOIN crm_etapas stage ON stage.id = n.etapa_id AND stage.organization_id = n.organization_id
       LEFT JOIN users user_account ON user_account.id = n.responsavel_id
      WHERE n.id = $1 AND n.organization_id = $2 ${lock ? 'FOR UPDATE OF n' : ''}`, [id, organizationId]
  );
  if (!result.rowCount) throw new AppError('Negociação não encontrada.', { statusCode: 404, code: 'CRM_NEGOTIATION_NOT_FOUND' });
  return result.rows[0];
};
const appendHistory = (db, organizationId, negotiationId, actorUserId, { title, description = null, type = 'manual' }) => db.query(
  `INSERT INTO crm_historico (organization_id, negociacao_id, titulo, descricao, tipo, criado_por)
   VALUES ($1, $2, $3, $4, $5, $6)`, [organizationId, negotiationId, title, description, type, actorUserId]
);
const getNegotiationDetail = async (db, organizationId, id) => {
  const negotiation = await assertNegotiation(db, organizationId, id);
  const [tasks, history, items] = await Promise.all([
    db.query(`SELECT id, negociacao_id AS "negociacaoId", texto, feita, prazo, criado_em AS "criadoEm" FROM crm_tarefas WHERE organization_id = $1 AND negociacao_id = $2 ORDER BY feita, prazo NULLS LAST, criado_em DESC`, [organizationId, id]),
    db.query(`SELECT h.id, h.negociacao_id AS "negociacaoId", h.titulo, h.descricao, h.tipo, h.criado_em AS "criadoEm", h.criado_por AS "criadoPor", u.name AS "criadoPorNome" FROM crm_historico h LEFT JOIN users u ON u.id = h.criado_por WHERE h.organization_id = $1 AND h.negociacao_id = $2 ORDER BY h.criado_em DESC`, [organizationId, id]),
    db.query(`SELECT id, negociacao_id AS "negociacaoId", nome_produto AS "nomeProduto", quantidade, preco_cents AS "precoCents" FROM crm_propostas_itens WHERE organization_id = $1 AND negociacao_id = $2 ORDER BY nome_produto`, [organizationId, id])
  ]);
  const proposalItems = items.rows.map(proposalPublic);
  return { negotiation: { ...negotiationPublic(negotiation), stage: { id: negotiation.etapaId, name: negotiation.stageName, color: negotiation.stageColor }, tasks: tasks.rows.map(taskPublic), history: history.rows.map(historyPublic), proposalItems, proposalTotalCents: proposalItems.reduce((total, item) => total + item.totalCents, 0) } };
};

export const registerCrmRoutes = async app => {
  const protectedRoute = [requireAuth, requireAccountAccess, requireModule('crm'), requireRoles(crmRoles)];

  app.get('/crm/etapas', { preHandler: protectedRoute }, async request => {
    const stages = await request.tenantDb.query('SELECT id, nome, cor, ordem FROM crm_etapas WHERE organization_id = $1 ORDER BY ordem', [request.auth.organization.id]);
    return { stages: stages.rows.map(stagePublic) };
  });
  app.post('/crm/etapas', { preHandler: [...protectedRoute, requireCsrf, requireRoles(crmManagerRoles)] }, async (request, reply) => {
    const payload = validate(stageSchema, request.body);
    const stage = await request.tenantDb.transaction(async transaction => {
      const result = await transaction.query('INSERT INTO crm_etapas (organization_id, nome, cor, ordem) VALUES ($1, $2, $3, $4) RETURNING id, nome, cor, ordem', [request.auth.organization.id, payload.nome, payload.cor, payload.ordem]);
      await recordAudit(transaction, { organizationId: request.auth.organization.id, actorUserId: request.auth.id, action: 'crm.stage_created', entityType: 'crm_stage', entityId: result.rows[0].id });
      return stagePublic(result.rows[0]);
    });
    return reply.code(201).send({ stage });
  });
  app.patch('/crm/etapas/:id', { preHandler: [...protectedRoute, requireCsrf, requireRoles(crmManagerRoles)] }, async request => {
    const { id } = validate(idSchema, request.params); const payload = validate(stageUpdateSchema, request.body);
    const result = await request.tenantDb.transaction(async transaction => {
      const updated = await transaction.query(`UPDATE crm_etapas SET nome = COALESCE($3, nome), cor = COALESCE($4, cor), ordem = COALESCE($5, ordem) WHERE id = $1 AND organization_id = $2 RETURNING id, nome, cor, ordem`, [id, request.auth.organization.id, payload.nome ?? null, payload.cor ?? null, payload.ordem ?? null]);
      if (!updated.rowCount) throw new AppError('Etapa não encontrada.', { statusCode: 404, code: 'CRM_STAGE_NOT_FOUND' });
      await recordAudit(transaction, { organizationId: request.auth.organization.id, actorUserId: request.auth.id, action: 'crm.stage_updated', entityType: 'crm_stage', entityId: id });
      return stagePublic(updated.rows[0]);
    });
    return { stage: result };
  });
  app.delete('/crm/etapas/:id', { preHandler: [...protectedRoute, requireCsrf, requireRoles(crmManagerRoles)] }, async (request, reply) => {
    const { id } = validate(idSchema, request.params);
    await request.tenantDb.transaction(async transaction => {
      const count = await transaction.query('SELECT COUNT(*) AS total FROM crm_etapas WHERE organization_id = $1', [request.auth.organization.id]);
      if (Number(count.rows[0].total) <= 1) throw new AppError('A empresa precisa manter ao menos uma etapa.', { statusCode: 409, code: 'CRM_LAST_STAGE' });
      const removed = await transaction.query('DELETE FROM crm_etapas WHERE id = $1 AND organization_id = $2 RETURNING id', [id, request.auth.organization.id]);
      if (!removed.rowCount) throw new AppError('Etapa não encontrada.', { statusCode: 404, code: 'CRM_STAGE_NOT_FOUND' });
      await recordAudit(transaction, { organizationId: request.auth.organization.id, actorUserId: request.auth.id, action: 'crm.stage_deleted', entityType: 'crm_stage', entityId: id });
    });
    return reply.code(204).send();
  });

  app.get('/crm/negociacoes', { preHandler: protectedRoute }, async request => {
    const query = validate(groupedQuerySchema, request.query);
    const [stageResult, negotiationResult] = await Promise.all([
      request.tenantDb.query('SELECT id, nome, cor, ordem FROM crm_etapas WHERE organization_id = $1 ORDER BY ordem', [request.auth.organization.id]),
      request.tenantDb.query(`SELECT n.id, n.etapa_id AS "etapaId", n.nome, n.valor_cents AS "valorCents", n.qualificacao, n.fonte, n.campanha, n.responsavel_id AS "responsavelId", n.criado_em AS "criadoEm", n.atualizado_em AS "atualizadoEm", u.name AS "responsavelNome" FROM crm_negociacoes n LEFT JOIN users u ON u.id = n.responsavel_id WHERE n.organization_id = $1 ORDER BY n.criado_em DESC`, [request.auth.organization.id])
    ]);
    const negotiations = negotiationResult.rows.map(negotiationPublic);
    if (query.agrupado_por_etapa !== 'true') return { negotiations };
    const stages = stageResult.rows.map(stage => ({ ...stagePublic(stage), negotiations: [], totalCents: 0 }));
    const byStage = new Map(stages.map(stage => [stage.id, stage]));
    negotiations.forEach(negotiation => { const stage = byStage.get(negotiation.stageId); if (stage) { stage.negotiations.push(negotiation); stage.totalCents += negotiation.valueCents; } });
    return { stages };
  });
  app.post('/crm/negociacoes', { preHandler: [...protectedRoute, requireCsrf] }, async (request, reply) => {
    const payload = validate(negotiationSchema, request.body);
    const detail = await request.tenantDb.transaction(async transaction => {
      await assertStage(transaction, request.auth.organization.id, payload.etapaId); await assertResponsible(transaction, request.auth.organization.id, payload.responsavelId);
      const created = await transaction.query(`INSERT INTO crm_negociacoes (organization_id, etapa_id, nome, valor_cents, qualificacao, fonte, campanha, responsavel_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [request.auth.organization.id, payload.etapaId, payload.nome, payload.valorCents, payload.qualificacao, payload.fonte, payload.campanha, payload.responsavelId]);
      await appendHistory(transaction, request.auth.organization.id, created.rows[0].id, request.auth.id, { title: 'Negociação criada', type: 'manual' });
      await recordAudit(transaction, { organizationId: request.auth.organization.id, actorUserId: request.auth.id, action: 'crm.negotiation_created', entityType: 'crm_negotiation', entityId: created.rows[0].id });
      return getNegotiationDetail(transaction, request.auth.organization.id, created.rows[0].id);
    });
    return reply.code(201).send(detail);
  });
  app.get('/crm/negociacoes/:id', { preHandler: protectedRoute }, async request => getNegotiationDetail(request.tenantDb, request.auth.organization.id, validate(idSchema, request.params).id));
  app.patch('/crm/negociacoes/:id', { preHandler: [...protectedRoute, requireCsrf] }, async request => {
    const { id } = validate(idSchema, request.params); const payload = validate(negotiationUpdateSchema, request.body);
    const detail = await request.tenantDb.transaction(async transaction => {
      await assertNegotiation(transaction, request.auth.organization.id, id, true); if (payload.responsavelId !== undefined) await assertResponsible(transaction, request.auth.organization.id, payload.responsavelId);
      await transaction.query(`UPDATE crm_negociacoes SET nome = COALESCE($3, nome), valor_cents = COALESCE($4, valor_cents), qualificacao = COALESCE($5, qualificacao), fonte = COALESCE($6, fonte), campanha = COALESCE($7, campanha), responsavel_id = CASE WHEN $8::boolean THEN $9 ELSE responsavel_id END WHERE id = $1 AND organization_id = $2`, [id, request.auth.organization.id, payload.nome ?? null, payload.valorCents ?? null, payload.qualificacao ?? null, payload.fonte ?? null, payload.campanha ?? null, payload.responsavelId !== undefined, payload.responsavelId ?? null]);
      await recordAudit(transaction, { organizationId: request.auth.organization.id, actorUserId: request.auth.id, action: 'crm.negotiation_updated', entityType: 'crm_negotiation', entityId: id });
      return getNegotiationDetail(transaction, request.auth.organization.id, id);
    }); return detail;
  });
  app.patch('/crm/negociacoes/:id/etapa', { preHandler: [...protectedRoute, requireCsrf] }, async request => {
    const { id } = validate(idSchema, request.params); const { etapaId } = validate(stageMoveSchema, request.body);
    const detail = await request.tenantDb.transaction(async transaction => {
      const negotiation = await assertNegotiation(transaction, request.auth.organization.id, id, true); const nextStage = await assertStage(transaction, request.auth.organization.id, etapaId);
      if (negotiation.etapaId !== etapaId) { await transaction.query('UPDATE crm_negociacoes SET etapa_id = $3 WHERE id = $1 AND organization_id = $2', [id, request.auth.organization.id, etapaId]); await appendHistory(transaction, request.auth.organization.id, id, request.auth.id, { title: 'Etapa alterada', description: `${negotiation.stageName} → ${nextStage.nome}`, type: 'mudanca_etapa' }); }
      await recordAudit(transaction, { organizationId: request.auth.organization.id, actorUserId: request.auth.id, action: 'crm.negotiation_stage_changed', entityType: 'crm_negotiation', entityId: id, metadata: { stageId: etapaId } }); return getNegotiationDetail(transaction, request.auth.organization.id, id);
    }); return detail;
  });

  app.post('/crm/negociacoes/:id/tarefas', { preHandler: [...protectedRoute, requireCsrf] }, async (request, reply) => {
    const { id } = validate(idSchema, request.params); const payload = validate(taskSchema, request.body);
    const task = await request.tenantDb.transaction(async transaction => { await assertNegotiation(transaction, request.auth.organization.id, id); const result = await transaction.query('INSERT INTO crm_tarefas (organization_id, negociacao_id, texto, prazo) VALUES ($1, $2, $3, $4) RETURNING id, negociacao_id AS "negociacaoId", texto, feita, prazo, criado_em AS "criadoEm"', [request.auth.organization.id, id, payload.texto, payload.prazo]); await appendHistory(transaction, request.auth.organization.id, id, request.auth.id, { title: 'Tarefa criada', description: payload.texto, type: 'tarefa' }); return taskPublic(result.rows[0]); });
    return reply.code(201).send({ task });
  });
  app.patch('/crm/tarefas/:taskId', { preHandler: [...protectedRoute, requireCsrf] }, async request => {
    const { taskId } = validate(taskIdSchema, request.params); const payload = validate(taskUpdateSchema, request.body);
    const task = await request.tenantDb.transaction(async transaction => { const existing = await transaction.query('SELECT id, negociacao_id AS "negociacaoId", feita FROM crm_tarefas WHERE id = $1 AND organization_id = $2 FOR UPDATE', [taskId, request.auth.organization.id]); if (!existing.rowCount) throw new AppError('Tarefa não encontrada.', { statusCode: 404, code: 'CRM_TASK_NOT_FOUND' }); const changedDone = payload.feita !== undefined && payload.feita !== existing.rows[0].feita; const updated = await transaction.query(`UPDATE crm_tarefas SET texto = COALESCE($3, texto), feita = COALESCE($4, feita), prazo = CASE WHEN $5::boolean THEN $6 ELSE prazo END WHERE id = $1 AND organization_id = $2 RETURNING id, negociacao_id AS "negociacaoId", texto, feita, prazo, criado_em AS "criadoEm"`, [taskId, request.auth.organization.id, payload.texto ?? null, payload.feita ?? null, payload.prazo !== undefined, payload.prazo ?? null]); if (changedDone) await appendHistory(transaction, request.auth.organization.id, existing.rows[0].negociacaoId, request.auth.id, { title: updated.rows[0].feita ? 'Tarefa concluída' : 'Tarefa reaberta', description: updated.rows[0].texto, type: 'tarefa' }); return taskPublic(updated.rows[0]); }); return { task };
  });
  app.delete('/crm/tarefas/:taskId', { preHandler: [...protectedRoute, requireCsrf] }, async (request, reply) => { const { taskId } = validate(taskIdSchema, request.params); const deleted = await request.tenantDb.query('DELETE FROM crm_tarefas WHERE id = $1 AND organization_id = $2 RETURNING id', [taskId, request.auth.organization.id]); if (!deleted.rowCount) throw new AppError('Tarefa não encontrada.', { statusCode: 404, code: 'CRM_TASK_NOT_FOUND' }); return reply.code(204).send(); });

  app.post('/crm/negociacoes/:id/propostas/itens', { preHandler: [...protectedRoute, requireCsrf] }, async (request, reply) => { const { id } = validate(idSchema, request.params); const payload = validate(proposalSchema, request.body); const item = await request.tenantDb.transaction(async transaction => { await assertNegotiation(transaction, request.auth.organization.id, id); const result = await transaction.query('INSERT INTO crm_propostas_itens (organization_id, negociacao_id, nome_produto, quantidade, preco_cents) VALUES ($1, $2, $3, $4, $5) RETURNING id, negociacao_id AS "negociacaoId", nome_produto AS "nomeProduto", quantidade, preco_cents AS "precoCents"', [request.auth.organization.id, id, payload.nomeProduto, payload.quantidade, payload.precoCents]); return proposalPublic(result.rows[0]); }); return reply.code(201).send({ item }); });
  app.patch('/crm/propostas/itens/:itemId', { preHandler: [...protectedRoute, requireCsrf] }, async request => { const { itemId } = validate(itemIdSchema, request.params); const payload = validate(proposalUpdateSchema, request.body); const result = await request.tenantDb.query(`UPDATE crm_propostas_itens SET nome_produto = COALESCE($3, nome_produto), quantidade = COALESCE($4, quantidade), preco_cents = COALESCE($5, preco_cents) WHERE id = $1 AND organization_id = $2 RETURNING id, negociacao_id AS "negociacaoId", nome_produto AS "nomeProduto", quantidade, preco_cents AS "precoCents"`, [itemId, request.auth.organization.id, payload.nomeProduto ?? null, payload.quantidade ?? null, payload.precoCents ?? null]); if (!result.rowCount) throw new AppError('Item de proposta não encontrado.', { statusCode: 404, code: 'CRM_PROPOSAL_ITEM_NOT_FOUND' }); return { item: proposalPublic(result.rows[0]) }; });
  app.delete('/crm/propostas/itens/:itemId', { preHandler: [...protectedRoute, requireCsrf] }, async (request, reply) => { const { itemId } = validate(itemIdSchema, request.params); const deleted = await request.tenantDb.query('DELETE FROM crm_propostas_itens WHERE id = $1 AND organization_id = $2 RETURNING id', [itemId, request.auth.organization.id]); if (!deleted.rowCount) throw new AppError('Item de proposta não encontrado.', { statusCode: 404, code: 'CRM_PROPOSAL_ITEM_NOT_FOUND' }); return reply.code(204).send(); });
  app.post('/crm/negociacoes/:id/historico', { preHandler: [...protectedRoute, requireCsrf] }, async (request, reply) => { const { id } = validate(idSchema, request.params); const payload = validate(manualHistorySchema, request.body); const history = await request.tenantDb.transaction(async transaction => { await assertNegotiation(transaction, request.auth.organization.id, id); const result = await transaction.query(`INSERT INTO crm_historico (organization_id, negociacao_id, titulo, descricao, tipo, criado_por) VALUES ($1, $2, $3, $4, 'manual', $5) RETURNING id, negociacao_id AS "negociacaoId", titulo, descricao, tipo, criado_em AS "criadoEm", criado_por AS "criadoPor"`, [request.auth.organization.id, id, payload.titulo, payload.descricao, request.auth.id]); return historyPublic(result.rows[0]); }); return reply.code(201).send({ history }); });
};
