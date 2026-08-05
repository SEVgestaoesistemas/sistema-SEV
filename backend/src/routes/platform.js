import { z } from 'zod';
import { requireAuth, requireCsrf, requirePlatformAdmin } from '../auth/middleware.js';
import { bootstrapPlatformAdministrator, createCompany, listCompanies, updateCompanyPlan } from '../platform/service.js';
import { dateSchema, emailSchema, validate } from './validation.js';

const companySchema = z.object({
  companyName: z.string().trim().min(2).max(100),
  administratorName: z.string().trim().min(3).max(100),
  administratorEmail: emailSchema,
  planExpiresAt: dateSchema
});

const updatePlanSchema = z.object({ planExpiresAt: dateSchema });
const companyIdSchema = z.object({ id: z.string().uuid() });
const bootstrapSchema = z.object({ email: emailSchema, token: z.string().min(24).max(256) });

export const registerPlatformRoutes = async app => {
  app.post('/platform/bootstrap', {
    config: { rateLimit: { max: 3, timeWindow: '1 hour' } }
  }, async request => {
    const payload = validate(bootstrapSchema, request.body);
    const result = await bootstrapPlatformAdministrator(app.db, payload, app.config);
    return { administrator: result.administrator };
  });

  app.get('/platform/companies', {
    preHandler: [requireAuth, requirePlatformAdmin]
  }, async () => ({ companies: await listCompanies(app.db) }));

  app.post('/platform/companies', {
    preHandler: [requireAuth, requireCsrf, requirePlatformAdmin]
  }, async (request, reply) => {
    const payload = validate(companySchema, request.body);
    const result = await createCompany(app.db, payload, request.auth);
    return reply.code(201).send(result);
  });

  app.patch('/platform/companies/:id/plan', {
    preHandler: [requireAuth, requireCsrf, requirePlatformAdmin]
  }, async request => {
    const { id } = validate(companyIdSchema, request.params);
    const { planExpiresAt } = validate(updatePlanSchema, request.body);
    return { company: await updateCompanyPlan(app.db, id, planExpiresAt, request.auth) };
  });
};
