CREATE TABLE push_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT,
  push_token   TEXT NOT NULL UNIQUE,
  platform     TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  app_version  TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  last_used_at INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX idx_push_tokens_user ON push_tokens (user_id)
  WHERE is_active = 1;

CREATE TABLE cache_translation (
  cache_key  TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  tier       TEXT NOT NULL DEFAULT 'free',
  result     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_translation_expires ON cache_translation (expires_at);

CREATE TABLE cache_transcription (
  cache_key  TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  tier       TEXT NOT NULL DEFAULT 'free',
  result     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_transcription_expires ON cache_transcription (expires_at);

CREATE TABLE cache_lang (
  cache_key     TEXT PRIMARY KEY,
  detected_lang TEXT NOT NULL,
  expires_at    INTEGER NOT NULL
);

CREATE INDEX idx_lang_expires ON cache_lang (expires_at);

CREATE TABLE webhook_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL
);

CREATE INDEX idx_webhook_idempotency_expires
  ON webhook_idempotency (expires_at);
