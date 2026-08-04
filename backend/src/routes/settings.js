import { z } from 'zod';
import { recordAudit } from '../audit.js';
import { requireAuth, requireCsrf, requireRoles } from '../auth/middleware.js';
import { validate } from './validation.js';

const defaults = {
  companyShortName: 'SEV',
  language: 'pt-BR',
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
  criticalStockAlerts: true
};

const settingsSchema = z.object({
  companyName: z.string().trim().min(2).max(100).optional(),
  companyShortName: z.string().trim().min(2).max(30).optional(),
  language: z.literal('pt-BR').optional(),
  currency: z.literal('BRL').optional(),
  timezone: z.literal('America/Sao_Paulo').optional(),
  criticalStockAlerts: z.boolean().optional()
}).refine(value => Object.keys(value).length > 0);

const settingsRoles = ['owner', 'admin'];

const shapeSettings = organization => ({
  companyName: organization.name,
  ...defaults,
  ...(organization.settings || {})
});

export const registerSettingsRoutes = async app => {
  app.get('/settings', { preHandler: [requireAuth, requireRoles(settingsRoles)] }, async request => {
    const result = await app.db.query('SELECT name, settings FROM organizations WHERE id = $1', [request.auth.organization.id]);
    return { settings: shapeSettings(result.rows[0]) };
  });

  app.patch('/settings', { preHandler: [requireAuth, requireCsrf, requireRoles(settingsRoles)] }, async request => {
    const payload = validate(settingsSchema, request.body);
    const settings = await app.db.transaction(async transaction => {
      const current = await transaction.query('SELECT name, settings FROM organizations WHERE id = $1 FOR UPDATE', [request.auth.organization.id]);
      const oldOrganization = current.rows[0];
      const nextSettings = {
        ...defaults,
        ...(oldOrganization.settings || {}),
        ...Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'companyName'))
      };
      const name = payload.companyName || oldOrganization.name;
      const result = await transaction.query(
        'UPDATE organizations SET name = $2, settings = $3::jsonb WHERE id = $1 RETURNING name, settings',
        [request.auth.organization.id, name, JSON.stringify(nextSettings)]
      );
      await recordAudit(transaction, {
        organizationId: request.auth.organization.id,
        actorUserId: request.auth.id,
        action: 'settings.updated',
        entityType: 'organization',
        entityId: request.auth.organization.id,
        metadata: { fields: Object.keys(payload) }
      });
      return shapeSettings(result.rows[0]);
    });
    return { settings };
  });
};
