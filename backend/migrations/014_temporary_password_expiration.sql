ALTER TABLE users
  ADD COLUMN temporary_password_expires_at TIMESTAMPTZ;

-- Existing forced password changes predate the expiration field. They must be
-- reissued by a platform administrator instead of remaining valid indefinitely.
UPDATE users
   SET temporary_password_expires_at = now()
 WHERE force_password_change = true
   AND temporary_password_expires_at IS NULL;

ALTER TABLE users
  ADD CONSTRAINT users_temporary_password_state CHECK (
    (force_password_change = false AND temporary_password_expires_at IS NULL)
    OR
    (force_password_change = true AND temporary_password_expires_at IS NOT NULL)
  );

CREATE INDEX users_temporary_password_expiry
  ON users (temporary_password_expires_at)
  WHERE force_password_change = true;
