-- Monthly usage and one shared AI credit pool. Translation, transcription,
-- speech, and live dictation all spend the same credits, so the three core
-- features exhaust together instead of one meter running dry first.

ALTER TABLE user_daily_usage ADD COLUMN transcribe_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_daily_usage ADD COLUMN stream_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_daily_usage ADD COLUMN ai_credits REAL NOT NULL DEFAULT 0;

CREATE TABLE user_monthly_usage (
  user_id          TEXT NOT NULL,
  month            TEXT NOT NULL,
  translate_count  INTEGER NOT NULL DEFAULT 0,
  transcribe_count INTEGER NOT NULL DEFAULT 0,
  transcribe_ms    INTEGER NOT NULL DEFAULT 0,
  speech_chars     INTEGER NOT NULL DEFAULT 0,
  stream_count     INTEGER NOT NULL DEFAULT 0,
  stream_ms        INTEGER NOT NULL DEFAULT 0,
  ai_credits       REAL NOT NULL DEFAULT 0,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (user_id, month)
);

CREATE INDEX idx_monthly_usage_month ON user_monthly_usage (month);
