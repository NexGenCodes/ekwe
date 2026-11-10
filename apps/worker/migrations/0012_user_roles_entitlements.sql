-- Adds first-class role, suspension, and explicit entitlements.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
  CHECK (role IN ('user', 'admin'));

ALTER TABLE users ADD COLUMN suspended_at INTEGER;
ALTER TABLE users ADD COLUMN suspended_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

CREATE TABLE IF NOT EXISTS user_entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('premium')),
  source TEXT NOT NULL CHECK (source IN ('staff', 'manual', 'billing', 'promo')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  starts_at INTEGER NOT NULL,
  expires_at INTEGER,
  granted_by TEXT,
  reason TEXT,
  external_ref TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_entitlements_user
  ON user_entitlements (user_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_user_entitlements_user_source
  ON user_entitlements (user_id, source, status);
