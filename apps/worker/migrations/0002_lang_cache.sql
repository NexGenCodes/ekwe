-- Language auto-detection cache table for Ekwe.
-- Added in 0002: the original migration only created cache_translation and
-- cache_transcription, but autoDetect.ts (via d1GetLang/d1PutLang) and the
-- scheduled cleanup already reference cache_lang. This table is shared across
-- users (same text -> same detection), so it omits user_id/tier columns.

CREATE TABLE IF NOT EXISTS cache_lang (
  cache_key     TEXT PRIMARY KEY,
  detected_lang TEXT NOT NULL,
  expires_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lang_expires ON cache_lang(expires_at);
