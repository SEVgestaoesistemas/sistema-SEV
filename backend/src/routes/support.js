import { z } from 'zod';
import { AppError } from '../errors.js';
import { recordAudit } from '../audit.js';
import { requireAccountAccess, requireAuth, requireCsrf } from '../auth/middleware.js';
import { validate } from './validation.js';

const supportQuestionSchema = z.object({
  message: z.string().trim().min(2).max(1000)
});

const outsideScopeReply = 'Posso ajudar somente com o uso do sistema SEV. Para esse assunto, sua dúvida será encaminhada ao suporte humano.';
const humanSupportReply = 'Não encontrei uma orientação segura para essa dúvida. Ela será encaminhada ao suporte humano.';
const usageDateSql = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";

const reserveChatUsage = async (db, { organizationId, userId, userLimit, organizationLimit }) => db.transaction(async transaction => {
  await transaction.query(`SELECT pg_advisory_xact_lock(hashtext('support-chat:' || $1))`, [organizationId]);
  const organizationUsage = await transaction.query(
    `SELECT COALESCE(SUM(request_count), 0) AS "requestCount"
       FROM support_chat_usage
      WHERE organization_id = $1 AND usage_date = ${usageDateSql}`,
    [organizationId]
  );
  if (Number(organizationUsage.rows[0].requestCount) >= organizationLimit) {
    throw new AppError('Esta empresa atingiu o limite diário do assistente. Tente novamente amanhã ou fale com o suporte humano.', {
      statusCode: 429,
      code: 'SUPPORT_ORGANIZATION_RATE_LIMIT'
    });
  }

  const userUsage = await transaction.query(
    `SELECT request_count AS "requestCount"
       FROM support_chat_usage
      WHERE organization_id = $1 AND user_id = $2 AND usage_date = ${usageDateSql}
      FOR UPDATE`,
    [organizationId, userId]
  );
  if (Number(userUsage.rows[0]?.requestCount || 0) >= userLimit) {
    throw new AppError('Você atingiu o limite diário do assistente. Tente novamente amanhã ou fale com o suporte humano.', {
      statusCode: 429,
      code: 'SUPPORT_USER_RATE_LIMIT'
    });
  }

  const updated = await transaction.query(
    `INSERT INTO support_chat_usage (organization_id, user_id, usage_date, request_count)
     VALUES ($1, $2, ${usageDateSql}, 1)
     ON CONFLICT (organization_id, user_id, usage_date)
     DO UPDATE SET request_count = support_chat_usage.request_count + 1
     RETURNING request_count AS "requestCount"`,
    [organizationId, userId]
  );
  const currentUserCount = Number(updated.rows[0].requestCount);
  return {
    userRemaining: Math.max(0, userLimit - currentUserCount),
    organizationRemaining: Math.max(0, organizationLimit - Number(organizationUsage.rows[0].requestCount) - 1)
  };
});

export const registerSupportRoutes = async app => {
  app.post('/support/chat', {
    preHandler: [requireAuth, requireCsrf, requireAccountAccess]
  }, async request => {
    const { message } = validate(supportQuestionSchema, request.body);
    if (!request.server.geminiChat.isConfigured) {
      throw new AppError('O assistente de IA ainda não está configurado. Sua dúvida será encaminhada ao suporte humano.', {
        statusCode: 503,
        code: 'SUPPORT_NOT_CONFIGURED'
      });
    }

    const usage = await reserveChatUsage(request.tenantDb, {
      organizationId: request.auth.organization.id,
      userId: request.auth.id,
      userLimit: request.server.config.supportChatUserDailyLimit,
      organizationLimit: request.server.config.supportChatOrganizationDailyLimit
    });
    const generated = await request.server.geminiChat(message, request.log);
    const needsHuman = !generated.inScope || generated.needsHuman;
    const answer = !generated.inScope ? outsideScopeReply : generated.needsHuman ? humanSupportReply : generated.answer;

    await request.tenantDb.transaction(async transaction => {
      const conversation = await transaction.query(
        `INSERT INTO support_chat_conversations (organization_id, user_id, question, answer, in_scope, needs_human)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [request.auth.organization.id, request.auth.id, message, answer, generated.inScope, needsHuman]
      );
      await recordAudit(transaction, {
        organizationId: request.auth.organization.id,
        actorUserId: request.auth.id,
        action: 'support.chat_requested',
        entityType: 'support_chat',
        entityId: conversation.rows[0].id,
        metadata: { inScope: generated.inScope, needsHuman }
      });
    });
    return { answer, usage, needsHuman };
  });
};
