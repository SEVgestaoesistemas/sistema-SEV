-- Allows organization owners and administrators to change a member's role through the API.
DROP POLICY IF EXISTS tenant_memberships_update ON organization_memberships;
CREATE POLICY tenant_memberships_update ON organization_memberships
  FOR UPDATE TO sev_tenant_api
  USING (organization_id = sev_current_organization_id())
  WITH CHECK (organization_id = sev_current_organization_id());

-- Keeps the support conversation available for the organization and the platform support team.
CREATE TABLE support_chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  question TEXT NOT NULL CHECK (char_length(question) BETWEEN 2 AND 1000),
  answer TEXT NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 1200),
  in_scope BOOLEAN NOT NULL,
  needs_human BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX support_chat_conversations_organization_created
  ON support_chat_conversations (organization_id, created_at DESC);
CREATE INDEX support_chat_conversations_human_created
  ON support_chat_conversations (created_at DESC)
  WHERE needs_human = true;

REVOKE ALL ON TABLE support_chat_conversations FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE support_chat_conversations TO sev_tenant_api;

ALTER TABLE support_chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_chat_conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_support_chat_conversations_read ON support_chat_conversations
  FOR SELECT TO sev_tenant_api
  USING (organization_id = sev_current_organization_id());
CREATE POLICY tenant_support_chat_conversations_create ON support_chat_conversations
  FOR INSERT TO sev_tenant_api
  WITH CHECK (
    organization_id = sev_current_organization_id()
    AND user_id = sev_current_user_id()
  );
