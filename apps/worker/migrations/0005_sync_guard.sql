CREATE TABLE sync_cooldowns (
  user_id      TEXT PRIMARY KEY,
  last_push_at INTEGER NOT NULL
);

CREATE INDEX idx_history_sync ON history (user_id, updated_at, id);
