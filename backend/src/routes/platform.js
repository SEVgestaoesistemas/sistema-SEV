import { z } from 'zod';
import { requireAuth, requireCsrf, requirePlatformAdmin } from '../auth/middleware.js';
import {
  bootstrapPlatformAdministrator,
  createCompany,
  deleteCompanyPermanently,
  listCompanies,
  resetCompanyAdministratorPassword,
  setCompanySuspension,
  updateCompanyAdministrator,
  updateCompanyPlan
} from '../platform/service.js';
import { dateSchema, emailSchema, validate } from './validation.js';

const companySchema = z.object({
  companyName: z.string().trim().min(2).max(100),
  administratorName: z.string().trim().min(3).max(100),
  administratorEmail: emailSchema,
  planExpiresAt: dateSchema
});

const updatePlanSchema = z.object({ planExpiresAt: dateSchema });
const suspensionSchema = z.object({ suspended: z.boolean() });
const administratorSchema = z.object({
  administratorName: z.string().trim().min(3).max(100),
  administratorEmail: emailSchema
});
const deletionSchema = z.object({ confirmationName: z.string().trim().min(2).max(100) });
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

  app.patch('/platform/companies/:id/suspension', {
    preHandler: [requireAuth, requireCsrf, requirePlatformAdmin]
  }, async request => {
    const { id } = validate(companyIdSchema, request.params);
    const { suspended } = validate(suspensionSchema, request.body);
    return { company: await setCompanySuspension(app.db, id, suspended, request.auth) };
  });

  app.patch('/platform/companies/:id/administrator', {
    preHandler: [requireAuth, requireCsrf, requirePlatformAdmin]
  }, async request => {
    const { id } = validate(companyIdSchema, request.params);
    const payload = validate(administratorSchema, request.body);
    return { company: await updateCompanyAdministrator(app.db, id, payload, request.auth) };
  });

  app.post('/platform/companies/:id/temporary-password', {
    preHandler: [requireAuth, requireCsrf, requirePlatformAdmin]
  }, async request => {
    const { id } = validate(companyIdSchema, request.params);
    return resetCompanyAdministratorPassword(app.db, id, request.auth);
  });

  app.delete('/platform/companies/:id', {
    preHandler: [requireAuth, requireCsrf, requirePlatformAdmin]
  }, async (request, reply) => {
    const { id } = validate(companyIdSchema, request.params);
    const { confirmationName } = validate(deletionSchema, request.body);
    await deleteCompanyPermanently(app.db, id, confirmationName, request.auth);
    return reply.code(204).send();
  });
};
