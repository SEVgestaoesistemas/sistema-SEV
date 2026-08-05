-- Defense in depth for tenant-owned data. The API connection uses the
-- Supabase postgres role, which can bypass RLS, so tenant requests explicitly
-- SET LOCAL ROLE to this restricted role inside each database transaction.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sev_tenant_api') THEN
    CREATE ROLE sev_tenant_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

GRANT sev_tenant_api TO postgres;
GRANT USAGE ON SCHEMA public TO sev_tenant_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  organizations,
  users,
  organization_memberships,
  products,
  stock_movements,
  expenses,
  notifications,
  notification_reads,
  team_invitations,
  audit_logs
TO sev_tenant_api;

REVOKE ALL ON TABLE
  organizations,
  users,
  organization_memberships,
  products,
  stock_movements,
  expenses,
  notifications,
  notification_reads,
  team_invitations,
  audit_logs
FROM PUBLIC;

CREATE OR REPLACE FUNCTION sev_current_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION sev_current_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organizations_read ON organizations;
DROP POLICY IF EXISTS tenant_organizations_update ON organizations;
CREATE POLICY tenant_organizations_read ON organizations
  FOR SELECT TO sev_tenant_api
  USING (id = sev_current_organization_id());
CREATE POLICY tenant_organizations_update ON organizations
  FOR UPDATE TO sev_tenant_api
  USING (id = sev_current_organization_id())
  WITH CHECK (id = sev_current_organization_id());

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_users_read ON users;
DROP POLICY IF EXISTS tenant_users_update ON users;
CREATE POLICY tenant_users_read ON users
  FOR SELECT TO sev_tenant_api
  USING (
    id = sev_current_user_id()
    OR EXISTS (
      SELECT 1 FROM organization_memberships membership
       WHERE membership.user_id = users.id
         AND membership.organization_id = sev_current_organization_id()
    )
  );
CREATE POLICY tenant_users_update ON users
  FOR UPDATE TO sev_tenant_api
  USING (id = sev_current_user_id())
  WITH CHECK (id = sev_current_user_id());

ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_memberships_read ON organization_memberships;
CREATE POLICY tenant_memberships_read ON organization_memberships
  FOR SELECT TO sev_tenant_api
  USING (organization_id = sev_current_organization_id());

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_products_read ON products;
DROP POLICY IF EXISTS tenant_products_create ON products;
DROP POLICY IF EXISTS tenant_products_update ON products;
CREATE POLICY tenant_products_read ON products
  FOR SELECT TO sev_tenant_api
  USING (organization_id = sev_current_organization_id());
CREATE POLICY tenant_products_create ON products
  FOR INSERT TO sev_tenant_api
  WITH CHECK (organization_id = sev_current_organization_id());
CREATE POLICY tenant_products_update ON products
  FOR UPDATE TO sev_tenant_api
  USING (organization_id = sev_current_organization_id())
  WITH CHECK (organization_id = sev_current_organization_id());

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_stock_movements_read ON stock_movements;
DROP POLICY IF EXISTS tenant_stock_movements_create ON stock_movements;
CREATE POLICY tenant_stock_movements_read ON stock_movements
  FOR SELECT TO sev_tenant_api
  USING (organization_id = sev_current_organization_id());
CREATE POLICY tenant_stock_movements_create ON stock_movements
  FOR INSERT TO sev_tenant_api
  WITH CHECK (organization_id = sev_current_organization_id());

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_expenses_read ON expenses;
DROP POLICY IF EXISTS tenant_expenses_create ON expenses;
DROP POLICY IF EXISTS tenant_expenses_update ON expenses;
CREATE POLICY tenant_expenses_read ON expenses
  FOR SELECT TO sev_tenant_api
  USING (organization_id = sev_current_organization_id());
CREATE POLICY tenant_expenses_create ON expenses
  FOR INSERT TO sev_tenant_api
  WITH CHECK (organization_id = sev_current_organization_id());
CREATE POLICY tenant_expenses_update ON expenses
  FOR UPDATE TO sev_tenant_api
  USING (organization_id = sev_current_organization_id())
  WITH CHECK (organization_id = sev_current_organization_id());

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_notifications_read ON notifications;
DROP POLICY IF EXISTS tenant_notifications_create ON notifications;
CREATE POLICY tenant_notifications_read ON notifications
  FOR SELECT TO sev_tenant_api
  USING (
    organization_id = sev_current_organization_id()
    AND (user_id IS NULL OR user_id = sev_current_user_id())
  );
CREATE POLICY tenant_notifications_create ON notifications
  FOR INSERT TO sev_tenant_api
  WITH CHECK (
    organization_id = sev_current_organization_id()
    AND (user_id IS NULL OR user_id = sev_current_user_id())
  );

ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_reads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_notification_reads_read ON notification_reads;
DROP POLICY IF EXISTS tenant_notification_reads_create ON notification_reads;
DROP POLICY IF EXISTS tenant_notification_reads_update ON notification_reads;
CREATE POLICY tenant_notification_reads_read ON notification_reads
  FOR SELECT TO sev_tenant_api
  USING (
    user_id = sev_current_user_id()
    AND EXISTS (
      SELECT 1
        FROM notifications notification
       WHERE notification.id = notification_reads.notification_id
         AND notification.organization_id = sev_current_organization_id()
    )
  );
CREATE POLICY tenant_notification_reads_create ON notification_reads
  FOR INSERT TO sev_tenant_api
  WITH CHECK (
    user_id = sev_current_user_id()
    AND EXISTS (
      SELECT 1
        FROM notifications notification
       WHERE notification.id = notification_reads.notification_id
         AND notification.organization_id = sev_current_organization_id()
    )
  );
CREATE POLICY tenant_notification_reads_update ON notification_reads
  FOR UPDATE TO sev_tenant_api
  USING (
    user_id = sev_current_user_id()
    AND EXISTS (
      SELECT 1
        FROM notifications notification
       WHERE notification.id = notification_reads.notification_id
         AND notification.organization_id = sev_current_organization_id()
    )
  )
  WITH CHECK (
    user_id = sev_current_user_id()
    AND EXISTS (
      SELECT 1
        FROM notifications notification
       WHERE notification.id = notification_reads.notification_id
         AND notification.organization_id = sev_current_organization_id()
    )
  );

ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_invitations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_team_invitations_read ON team_invitations;
DROP POLICY IF EXISTS tenant_team_invitations_create ON team_invitations;
CREATE POLICY tenant_team_invitations_read ON team_invitations
  FOR SELECT TO sev_tenant_api
  USING (organization_id = sev_current_organization_id());
CREATE POLICY tenant_team_invitations_create ON team_invitations
  FOR INSERT TO sev_tenant_api
  WITH CHECK (organization_id = sev_current_organization_id());

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_audit_logs_read ON audit_logs;
DROP POLICY IF EXISTS tenant_audit_logs_create ON audit_logs;
CREATE POLICY tenant_audit_logs_read ON audit_logs
  FOR SELECT TO sev_tenant_api
  USING (organization_id = sev_current_organization_id());
CREATE POLICY tenant_audit_logs_create ON audit_logs
  FOR INSERT TO sev_tenant_api
  WITH CHECK (organization_id = sev_current_organization_id());
