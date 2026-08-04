export const recordAudit = async (db, {
  organizationId,
  actorUserId = null,
  action,
  entityType,
  entityId = null,
  metadata = {}
}) => db.query(
  `INSERT INTO audit_logs (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata)
   VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::jsonb)`,
  [organizationId, actorUserId, action, entityType, entityId, JSON.stringify(metadata)]
);
