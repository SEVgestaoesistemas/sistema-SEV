ALTER TABLE organizations
  ADD COLUMN plan_expires_at DATE;

ALTER TABLE users
  ADD COLUMN force_password_change BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE platform_administrators (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX organizations_plan_expires_at ON organizations (plan_expires_at);
