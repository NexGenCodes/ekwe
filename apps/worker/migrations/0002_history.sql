CREATE TABLE history (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL,
  type                 TEXT NOT NULL DEFAULT 'transcription',
  capture_id           TEXT,
  origin               TEXT NOT NULL DEFAULT 'echo',
  input                TEXT NOT NULL DEFAULT 'audio',
  source_lang          TEXT NOT NULL,
  target_lang          TEXT NOT NULL,
  transcript           TEXT NOT NULL DEFAULT '',
  translation_text     TEXT,
  transliteration_text TEXT,
  duration             REAL NOT NULL DEFAULT 0,
  source_app           TEXT NOT NULL DEFAULT '',
  voice_id             TEXT,
  stt_provider         TEXT NOT NULL DEFAULT '',
  mt_provider          TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  revision             INTEGER NOT NULL DEFAULT 1,
  deleted_at           INTEGER
);

CREATE INDEX idx_history_live_user
  ON history (user_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_history_user_capture
  ON history (user_id, capture_id);
