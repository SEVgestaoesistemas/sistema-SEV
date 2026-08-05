ALTER TABLE organizations
  ADD COLUMN is_suspended BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN suspended_at TIMESTAMPTZ;

CREATE INDEX organizations_suspended_lookup ON organizations (is_suspended) WHERE is_suspended = true;
