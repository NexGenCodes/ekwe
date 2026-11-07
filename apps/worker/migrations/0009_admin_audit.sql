-- Admin audit log: who did what to whom, when. Immutable from app code (insert-only).
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_log (target_user_id);
