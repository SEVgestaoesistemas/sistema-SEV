CREATE TABLE support_chat_usage (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0 AND request_count <= 100000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, usage_date)
);

CREATE INDEX support_chat_usage_organization_date
  ON support_chat_usage (organization_id, usage_date);
CREATE TRIGGER support_chat_usage_touch_updated_at
  BEFORE UPDATE ON support_chat_usage FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

GRANT SELECT, INSERT, UPDATE ON TABLE support_chat_usage TO sev_tenant_api;

ALTER TABLE support_chat_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_chat_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_support_chat_usage_read ON support_chat_usage
  FOR SELECT TO sev_tenant_api
  USING (organization_id = sev_current_organization_id());
CREATE POLICY tenant_support_chat_usage_create ON support_chat_usage
  FOR INSERT TO sev_tenant_api
  WITH CHECK (organization_id = sev_current_organization_id() AND user_id = sev_current_user_id());
CREATE POLICY tenant_support_chat_usage_update ON support_chat_usage
  FOR UPDATE TO sev_tenant_api
  USING (organization_id = sev_current_organization_id() AND user_id = sev_current_user_id())
  WITH CHECK (organization_id = sev_current_organization_id() AND user_id = sev_current_user_id());
