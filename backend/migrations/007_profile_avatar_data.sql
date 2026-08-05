ALTER TABLE users
  ADD COLUMN avatar_data TEXT,
  ADD CONSTRAINT users_avatar_data_size CHECK (
    avatar_data IS NULL OR octet_length(avatar_data) <= 700000
  );
