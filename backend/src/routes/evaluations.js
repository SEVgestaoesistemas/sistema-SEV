import { z } from 'zod';
import { AppError } from '../errors.js';
import { recordAudit } from '../audit.js';
import { requireAccountAccess, requireAuth, requireCsrf, requireModule, requireRoles } from '../auth/middleware.js';
import { validate } from './validation.js';

const assessmentReadRoles = ['owner', 'admin', 'finance', 'inventory', 'operator'];
const assessmentManageRoles = ['owner', 'admin'];
const assessmentIdSchema = z.object({ id: z.string().uuid() });
const optionalTitle = z.string().trim().min(3).max(160).optional();
const optionSchema = z.object({
  texto: z.string().trim().min(1).max(600),
  correta: z.boolean()
});
const questionSchema = z.object({
  enunciado: z.string().trim().min(3).max(1000),
  opcoes: z.array(optionSchema).min(2).max(12)
}).superRefine((question, context) => {
  if (question.opcoes.filter(option => option.correta).length !== 1) {
    context.addIssue({ code: 'custom', path: ['opcoes'], message: 'Cada questão deve ter exatamente uma alternativa correta.' });
  }
});
const createAssessmentSchema = z.object({
  titulo: z.string().trim().min(3).max(160),
  notaMinima: z.coerce.number().int().min(0).max(100).default(70),
  questoes: z.array(questionSchema).min(1).max(100)
});
const updateAssessmentSchema = z.object({
  titulo: optionalTitle,
  notaMinima: z.coerce.number().int().min(0).max(100).optional(),
  questoes: z.array(questionSchema).min(1).max(100).optional()
}).refine(payload => Object.keys(payload).length > 0, { message: 'Informe ao menos um campo para atualizar.' });
const attemptSchema = z.object({
  respostas: z.array(z.object({ questaoId: z.string().uuid(), opcaoId: z.string().uuid() })).min(1).max(100)
});

const publicAttempt = row => ({
  id: row.id,
  evaluationId: row.avaliacaoId,
  userId: row.userId,
  userName: row.userName || null,
  correctAnswers: Number(row.acertos),
  totalQuestions: Number(row.totalQuestoes),
  scorePercent: Number(row.pctAcerto),
  approved: Boolean(row.aprovado),
  answeredAt: row.respondidoEm
});

const loadEvaluation = async (db, organizationId, id, includeAnswers) => {
  const assessmentResult = await db.query(
    `SELECT id, titulo, nota_minima AS "notaMinima", criado_por AS "createdBy", criado_em AS "createdAt", atualizado_em AS "updatedAt"
       FROM avaliacoes WHERE id = $1 AND organization_id = $2`,
    [id, organizationId]
  );
  if (!assessmentResult.rowCount) throw new AppError('Avaliação não encontrada.', { statusCode: 404, code: 'ASSESSMENT_NOT_FOUND' });

  const questionResult = await db.query(
    `SELECT q.id AS "questionId", q.enunciado, q.ordem AS "questionOrder", o.id AS "optionId", o.texto,
            o.correta, o.ordem AS "optionOrder"
       FROM avaliacao_questoes q
       JOIN avaliacao_opcoes o ON o.questao_id = q.id AND o.organization_id = q.organization_id
      WHERE q.avaliacao_id = $1 AND q.organization_id = $2
      ORDER BY q.ordem, o.ordem`,
    [id, organizationId]
  );
  const questions = new Map();
  for (const row of questionResult.rows) {
    if (!questions.has(row.questionId)) questions.set(row.questionId, {
      id: row.questionId, prompt: row.enunciado, order: Number(row.questionOrder), options: []
    });
    const option = { id: row.optionId, text: row.texto, order: Number(row.optionOrder) };
    if (includeAnswers) option.correct = Boolean(row.correta);
    questions.get(row.questionId).options.push(option);
  }
  return {
    id: assessmentResult.rows[0].id,
    title: assessmentResult.rows[0].titulo,
    passingScore: Number(assessmentResult.rows[0].notaMinima),
    createdBy: assessmentResult.rows[0].createdBy,
    createdAt: assessmentResult.rows[0].createdAt,
    updatedAt: assessmentResult.rows[0].updatedAt,
    questions: [...questions.values()]
  };
};

const assertAnswersMatchAssessment = (assessment, responses) => {
  const answerByQuestion = new Map();
  for (const response of responses) {
    if (answerByQuestion.has(response.questaoId)) {
      throw new AppError('Responda cada questão apenas uma vez.', { statusCode: 400, code: 'ASSESSMENT_ANSWERS_INVALID' });
    }
    answerByQuestion.set(response.questaoId, response.opcaoId);
  }
  if (answerByQuestion.size !== assessment.questions.length) {
    throw new AppError('Responda todas as questões antes de finalizar.', { statusCode: 400, code: 'ASSESSMENT_ANSWERS_INCOMPLETE' });
  }
  let correctAnswers = 0;
  const answerKey = assessment.questions.map(question => {
    const selectedOptionId = answerByQuestion.get(question.id);
    const selected = question.options.find(option => option.id === selectedOptionId);
    const correct = question.options.find(option => option.correct);
    if (!selected || !correct) {
      throw new AppError('Uma das respostas não pertence a esta avaliação.', { statusCode: 400, code: 'ASSESSMENT_ANSWERS_INVALID' });
    }
    const isCorrect = selected.id === correct.id;
    if (isCorrect) correctAnswers += 1;
    return { questionId: question.id, selectedOptionId, correctOptionId: correct.id, correct: isCorrect };
  });
  return { correctAnswers, answerKey };
};

const insertQuestions = async (db, organizationId, assessmentId, questions) => {
  for (const [questionIndex, question] of questions.entries()) {
    const createdQuestion = await db.query(
      `INSERT INTO avaliacao_questoes (organization_id, avaliacao_id, enunciado, ordem)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [organizationId, assessmentId, question.enunciado, questionIndex + 1]
    );
    for (const [optionIndex, option] of question.opcoes.entries()) {
      await db.query(
        `INSERT INTO avaliacao_opcoes (organization_id, questao_id, texto, correta, ordem)
         VALUES ($1, $2, $3, $4, $5)`,
        [organizationId, createdQuestion.rows[0].id, option.texto, option.correta, optionIndex + 1]
      );
    }
  }
};

export const registerEvaluationRoutes = async app => {
  const protectedRoute = [requireAuth, requireAccountAccess, requireModule('avaliacoes')];

  app.get('/avaliacoes', { preHandler: [...protectedRoute, requireRoles(assessmentReadRoles)] }, async request => {
    const includeAnswers = assessmentManageRoles.includes(request.auth.organization.role);
    const result = await request.tenantDb.query(
      `SELECT id FROM avaliacoes WHERE organization_id = $1 ORDER BY criado_em DESC`, [request.auth.organization.id]
    );
    const evaluations = await Promise.all(result.rows.map(row => loadEvaluation(
      request.tenantDb, request.auth.organization.id, row.id, includeAnswers
    )));
    return { evaluations };
  });

  app.post('/avaliacoes', {
    preHandler: [...protectedRoute, requireCsrf, requireRoles(assessmentManageRoles)]
  }, async (request, reply) => {
    const payload = validate(createAssessmentSchema, request.body);
    const evaluation = await request.tenantDb.transaction(async transaction => {
      const result = await transaction.query(
        `INSERT INTO avaliacoes (organization_id, titulo, nota_minima, criado_por)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [request.auth.organization.id, payload.titulo, payload.notaMinima, request.auth.id]
      );
      await insertQuestions(transaction, request.auth.organization.id, result.rows[0].id, payload.questoes);
      await recordAudit(transaction, {
        organizationId: request.auth.organization.id, actorUserId: request.auth.id,
        action: 'evaluations.created', entityType: 'evaluation', entityId: result.rows[0].id,
        metadata: { questionCount: payload.questoes.length }
      });
      return loadEvaluation(transaction, request.auth.organization.id, result.rows[0].id, true);
    });
    return reply.code(201).send({ evaluation });
  });

  app.patch('/avaliacoes/:id', {
    preHandler: [...protectedRoute, requireCsrf, requireRoles(assessmentManageRoles)]
  }, async request => {
    const { id } = validate(assessmentIdSchema, request.params);
    const payload = validate(updateAssessmentSchema, request.body);
    const evaluation = await request.tenantDb.transaction(async transaction => {
      const existing = await transaction.query(
        'SELECT id FROM avaliacoes WHERE id = $1 AND organization_id = $2 FOR UPDATE', [id, request.auth.organization.id]
      );
      if (!existing.rowCount) throw new AppError('Avaliação não encontrada.', { statusCode: 404, code: 'ASSESSMENT_NOT_FOUND' });
      await transaction.query(
        `UPDATE avaliacoes SET titulo = COALESCE($3, titulo), nota_minima = COALESCE($4, nota_minima)
          WHERE id = $1 AND organization_id = $2`,
        [id, request.auth.organization.id, payload.titulo ?? null, payload.notaMinima ?? null]
      );
      if (payload.questoes) {
        await transaction.query('DELETE FROM avaliacao_questoes WHERE avaliacao_id = $1 AND organization_id = $2', [id, request.auth.organization.id]);
        await insertQuestions(transaction, request.auth.organization.id, id, payload.questoes);
      }
      await recordAudit(transaction, {
        organizationId: request.auth.organization.id, actorUserId: request.auth.id,
        action: 'evaluations.updated', entityType: 'evaluation', entityId: id,
        metadata: { replacedQuestions: Boolean(payload.questoes) }
      });
      return loadEvaluation(transaction, request.auth.organization.id, id, true);
    });
    return { evaluation };
  });

  app.delete('/avaliacoes/:id', {
    preHandler: [...protectedRoute, requireCsrf, requireRoles(assessmentManageRoles)]
  }, async (request, reply) => {
    const { id } = validate(assessmentIdSchema, request.params);
    const deleted = await request.tenantDb.transaction(async transaction => {
      const result = await transaction.query(
        'DELETE FROM avaliacoes WHERE id = $1 AND organization_id = $2 RETURNING id', [id, request.auth.organization.id]
      );
      if (!result.rowCount) throw new AppError('Avaliação não encontrada.', { statusCode: 404, code: 'ASSESSMENT_NOT_FOUND' });
      await recordAudit(transaction, {
        organizationId: request.auth.organization.id, actorUserId: request.auth.id,
        action: 'evaluations.deleted', entityType: 'evaluation', entityId: id
      });
      return true;
    });
    if (deleted) return reply.code(204).send();
  });

  app.post('/avaliacoes/:id/tentativas', {
    preHandler: [...protectedRoute, requireCsrf, requireRoles(assessmentReadRoles)]
  }, async (request, reply) => {
    const { id } = validate(assessmentIdSchema, request.params);
    const payload = validate(attemptSchema, request.body);
    const result = await request.tenantDb.transaction(async transaction => {
      const assessment = await loadEvaluation(transaction, request.auth.organization.id, id, true);
      const { correctAnswers, answerKey } = assertAnswersMatchAssessment(assessment, payload.respostas);
      const totalQuestions = assessment.questions.length;
      const scorePercent = Number(((correctAnswers / totalQuestions) * 100).toFixed(2));
      const approved = scorePercent >= assessment.passingScore;
      const attempt = await transaction.query(
        `INSERT INTO avaliacao_tentativas (avaliacao_id, organization_id, user_id, acertos, total_questoes, pct_acerto, aprovado)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, avaliacao_id AS "avaliacaoId", user_id AS "userId", acertos, total_questoes AS "totalQuestoes",
                   pct_acerto AS "pctAcerto", aprovado, respondido_em AS "respondidoEm"`,
        [id, request.auth.organization.id, request.auth.id, correctAnswers, totalQuestions, scorePercent, approved]
      );
      await recordAudit(transaction, {
        organizationId: request.auth.organization.id, actorUserId: request.auth.id,
        action: 'evaluations.attempt_submitted', entityType: 'evaluation_attempt', entityId: attempt.rows[0].id,
        metadata: { evaluationId: id, correctAnswers, totalQuestions, scorePercent, approved }
      });
      return { attempt: publicAttempt(attempt.rows[0]), answerKey };
    });
    return reply.code(201).send(result);
  });

  app.get('/avaliacoes/:id/tentativas', {
    preHandler: [...protectedRoute, requireRoles(assessmentManageRoles)]
  }, async request => {
    const { id } = validate(assessmentIdSchema, request.params);
    const exists = await request.tenantDb.query(
      'SELECT 1 FROM avaliacoes WHERE id = $1 AND organization_id = $2', [id, request.auth.organization.id]
    );
    if (!exists.rowCount) throw new AppError('Avaliação não encontrada.', { statusCode: 404, code: 'ASSESSMENT_NOT_FOUND' });
    const attempts = await request.tenantDb.query(
      `SELECT attempt.id, attempt.avaliacao_id AS "avaliacaoId", attempt.user_id AS "userId", user_account.name AS "userName",
              attempt.acertos, attempt.total_questoes AS "totalQuestoes", attempt.pct_acerto AS "pctAcerto",
              attempt.aprovado, attempt.respondido_em AS "respondidoEm"
         FROM avaliacao_tentativas attempt
         JOIN users user_account ON user_account.id = attempt.user_id
        WHERE attempt.avaliacao_id = $1 AND attempt.organization_id = $2
        ORDER BY attempt.respondido_em DESC`,
      [id, request.auth.organization.id]
    );
    return { attempts: attempts.rows.map(publicAttempt) };
  });
};
