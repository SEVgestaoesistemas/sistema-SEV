import { z } from 'zod';
import { requireAccountAccess, requireAuth, requireCsrf, requireRoles } from '../auth/middleware.js';
import { createInvitation } from '../team/service.js';
import { emailSchema, validate } from './validation.js';

const teamRoles = ['owner', 'admin'];
const invitationSchema = z.object({
  name: z.string().trim().min(3).max(100),
  email: emailSchema,
  role: z.enum(['admin', 'finance', 'inventory', 'operator'])
});

export const registerTeamRoutes = async app => {
  app.get('/team', { preHandler: [requireAuth, requireAccountAccess, requireRoles(teamRoles)] }, async request => {
    const result = await request.tenantDb.query(
      `SELECT u.id, u.name, u.email, u.avatar_url AS "avatarUrl", membership.role,
              'active' AS status, membership.created_at AS "createdAt"
         FROM organization_memberships membership
         JOIN users u ON u.id = membership.user_id
        WHERE membership.organization_id = $1
       UNION ALL
       SELECT invitation.id, invitation.recipient_name AS name, invitation.email, NULL AS "avatarUrl", invitation.role,
              CASE WHEN invitation.expires_at <= now() THEN 'expired' ELSE 'invited' END AS status,
              invitation.created_at AS "createdAt"
         FROM team_invitations invitation
        WHERE invitation.organization_id = $1 AND invitation.accepted_at IS NULL AND invitation.revoked_at IS NULL
       ORDER BY "createdAt" ASC`,
      [request.auth.organization.id]
    );
    return { members: result.rows };
  });

  app.post('/team/invitations', {
    preHandler: [requireAuth, requireCsrf, requireAccountAccess, requireRoles(teamRoles)]
  }, async (request, reply) => {
    const payload = validate(invitationSchema, request.body);
    const invitation = await createInvitation(request.tenantDb, payload, request.auth, app.config);
    return reply.code(201).send({ invitation });
  });
};
