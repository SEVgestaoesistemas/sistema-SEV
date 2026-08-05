import { z } from 'zod';
import { recordAudit } from '../audit.js';
import { requireAccountAccess, requireAuth, requireCsrf } from '../auth/middleware.js';
import { emailSchema, validate } from './validation.js';

const maximumAvatarBytes = 500 * 1024;
const avatarDataSchema = z.union([
  z.string().max(700000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
  z.null()
]).superRefine((value, context) => {
  if (value === null) return;
  const encoded = value.slice(value.indexOf(',') + 1);
  if (Buffer.from(encoded, 'base64').byteLength > maximumAvatarBytes) {
    context.addIssue({ code: 'custom', message: 'A imagem excede o limite de 500 KB.' });
  }
});

const profileSchema = z.object({
  name: z.string().trim().min(3).max(100).optional(),
  email: emailSchema.optional(),
  avatarData: avatarDataSchema.optional()
}).refine(value => value.name !== undefined || value.email !== undefined || value.avatarData !== undefined);

export const registerProfileRoutes = async app => {
  app.get('/profile', { preHandler: [requireAuth, requireAccountAccess] }, async request => {
    const result = await request.tenantDb.query(
      'SELECT id, name, email, avatar_data AS "avatarData" FROM users WHERE id = $1',
      [request.auth.id]
    );
    return { profile: result.rows[0] };
  });

  app.patch('/profile', { preHandler: [requireAuth, requireCsrf, requireAccountAccess] }, async request => {
    const payload = validate(profileSchema, request.body);
    const profile = await request.tenantDb.transaction(async transaction => {
      const fields = [];
      const values = [request.auth.id];
      if (payload.name !== undefined) {
        values.push(payload.name);
        fields.push(`name = $${values.length}`);
      }
      if (payload.email !== undefined) {
        values.push(payload.email);
        fields.push(`email = $${values.length}`);
      }
      if (payload.avatarData !== undefined) {
        values.push(payload.avatarData);
        fields.push(`avatar_data = $${values.length}`);
      }
      const result = await transaction.query(
        `UPDATE users SET ${fields.join(', ')} WHERE id = $1
         RETURNING id, name, email, avatar_data AS "avatarData"`,
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
