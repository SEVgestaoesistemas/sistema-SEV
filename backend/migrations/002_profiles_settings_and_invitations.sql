ALTER TABLE organizations
  ADD COLUMN settings JSONB NOT NULL DEFAULT '{"companyShortName":"SEV","language":"pt-BR","currency":"BRL","timezone":"America/Sao_Paulo","criticalStockAlerts":true}'::jsonb;

ALTER TABLE users
  ADD COLUMN avatar_url TEXT CHECK (avatar_url IS NULL OR char_length(avatar_url) <= 500);

CREATE TABLE team_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recipient_name TEXT NOT NULL CHECK (char_length(recipient_name) BETWEEN 3 AND 100),
  email TEXT NOT NULL CHECK (email = lower(email)),
  role TEXT NOT NULL CHECK (role IN ('admin', 'finance', 'inventory', 'operator')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX team_invitations_one_active_email
  ON team_invitations (organization_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX team_invitations_active_lookup
  ON team_invitations (token_hash, expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
