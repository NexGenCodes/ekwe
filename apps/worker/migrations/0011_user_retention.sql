-- Retention controls for scheduled account deletion (delayed hard delete).
ALTER TABLE users ADD COLUMN deleted_at INTEGER;
ALTER TABLE users ADD COLUMN delete_after INTEGER;

CREATE INDEX IF NOT EXISTS idx_users_delete_after ON users (delete_after)
  WHERE delete_after IS NOT NULL;
