import { z } from 'zod';
import { requireAccountAccess, requireAuth, requireCsrf } from '../auth/middleware.js';
import { validate } from './validation.js';

const notificationIdSchema = z.object({ id: z.string().uuid() });

export const registerNotificationRoutes = async app => {
  app.get('/notifications', { preHandler: [requireAuth, requireAccountAccess] }, async request => {
    const result = await app.db.query(
      `SELECT n.id, n.category, n.title, n.message, n.created_at AS "createdAt",
              reads.read_at AS "readAt"
         FROM notifications n
         LEFT JOIN notification_reads reads ON reads.notification_id = n.id AND reads.user_id = $2
        WHERE n.organization_id = $1 AND (n.user_id IS NULL OR n.user_id = $2)
        ORDER BY n.created_at DESC
        LIMIT 50`,
      [request.auth.organization.id, request.auth.id]
    );
    return { notifications: result.rows };
  });

  app.patch('/notifications/:id/read', { preHandler: [requireAuth, requireCsrf, requireAccountAccess] }, async request => {
    const params = validate(notificationIdSchema, request.params);
    const result = await app.db.query(
      `INSERT INTO notification_reads (notification_id, user_id)
       SELECT id, $2 FROM notifications
        WHERE id = $1 AND organization_id = $3 AND (user_id IS NULL OR user_id = $2)
       ON CONFLICT (notification_id, user_id) DO UPDATE SET read_at = now()
       RETURNING notification_id AS "notificationId", read_at AS "readAt"`,
      [params.id, request.auth.id, request.auth.organization.id]
    );
    if (!result.rowCount) return { notification: null };
    return { notification: result.rows[0] };
  });

  app.post('/notifications/read-all', { preHandler: [requireAuth, requireCsrf, requireAccountAccess] }, async request => {
    await app.db.query(
      `INSERT INTO notification_reads (notification_id, user_id)
       SELECT n.id, $2 FROM notifications n
        WHERE n.organization_id = $1 AND (n.user_id IS NULL OR n.user_id = $2)
       ON CONFLICT (notification_id, user_id) DO UPDATE SET read_at = now()`,
      [request.auth.organization.id, request.auth.id]
    );
    return { updated: true };
  });
};
