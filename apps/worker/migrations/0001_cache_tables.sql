-- D1 cache tables for Ekwe
-- Replaces KV writes (1K/day free) with D1 (100K writes/day free)
-- Same code works on free tier now and paid tier later

CREATE TABLE IF NOT EXISTS cache_translation (
  cache_key TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL,
  tier      TEXT NOT NULL DEFAULT 'free',
  result    TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_translation_user ON cache_translation(user_id);
CREATE INDEX IF NOT EXISTS idx_translation_expires ON cache_translation(expires_at);

CREATE TABLE IF NOT EXISTS cache_transcription (
  cache_key TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL,
  tier      TEXT NOT NULL DEFAULT 'free',
  result    TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transcription_user ON cache_transcription(user_id);
CREATE INDEX IF NOT EXISTS idx_transcription_expires ON cache_transcription(expires_at);
