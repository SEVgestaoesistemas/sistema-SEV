import { z } from 'zod';
import { recordAudit } from '../audit.js';
import { requireAccountAccess, requireAuth, requireCsrf } from '../auth/middleware.js';
import { validate } from './validation.js';

const avatarUrlSchema = z.union([
  z.string().url().max(500).refine(value => new URL(value).protocol === 'https'),
  z.null()
]);
const profileSchema = z.object({
  name: z.string().trim().min(3).max(100).optional(),
  avatarUrl: avatarUrlSchema.optional()
}).refine(value => value.name !== undefined || value.avatarUrl !== undefined);

export const registerProfileRoutes = async app => {
  app.get('/profile', { preHandler: [requireAuth, requireAccountAccess] }, async request => {
    const result = await app.db.query(
      'SELECT id, name, email, avatar_url AS "avatarUrl" FROM users WHERE id = $1',
      [request.auth.id]
    );
    return { profile: result.rows[0] };
  });

  app.patch('/profile', { preHandler: [requireAuth, requireCsrf, requireAccountAccess] }, async request => {
    const payload = validate(profileSchema, request.body);
    const profile = await app.db.transaction(async transaction => {
      const fields = [];
      const values = [request.auth.id];
      if (payload.name !== undefined) {
        values.push(payload.name);
        fields.push(`name = $${values.length}`);
      }
      if (payload.avatarUrl !== undefined) {
        values.push(payload.avatarUrl);
        fields.push(`avatar_url = $${values.length}`);
      }
      const result = await transaction.query(
        `UPDATE users SET ${fields.join(', ')} WHERE id = $1
         RETURNING id, name, email, avatar_url AS "avatarUrl"`,
        values
      );
      await recordAudit(transaction, {
        organizationId: request.auth.organization.id,
        actorUserId: request.auth.id,
        action: 'profile.updated',
        entityType: 'user',
        entityId: request.auth.id,
        metadata: { fields: Object.keys(payload) }
      });
      return result.rows[0];
    });
    return { profile };
  });
};
