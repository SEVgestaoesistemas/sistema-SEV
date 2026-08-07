const criticalStockAlertsEnabled = async (transaction, organizationId) => {
  const result = await transaction.query(
    `SELECT CASE WHEN settings ->> 'criticalStockAlerts' = 'false' THEN false ELSE true END AS "enabled"
       FROM organizations
      WHERE id = $1`,
    [organizationId]
  );
  return result.rows[0]?.enabled !== false;
};

export const createCriticalStockAlert = async (transaction, { organizationId, title, message }) => {
  if (!(await criticalStockAlertsEnabled(transaction, organizationId))) return false;
  await transaction.query(
    `INSERT INTO notifications (organization_id, category, title, message)
     VALUES ($1, 'stock', $2, $3)`,
    [organizationId, title, message]
  );
  return true;
};
