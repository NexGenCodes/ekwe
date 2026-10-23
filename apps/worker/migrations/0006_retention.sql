-- Cache tables were the only rows storing expiry in seconds. Move them to
-- epoch milliseconds, matching sessions, usage, claims and history.
UPDATE cache_translation
   SET created_at = created_at * 1000, expires_at = expires_at * 1000;
UPDATE cache_transcription
   SET created_at = created_at * 1000, expires_at = expires_at * 1000;
UPDATE cache_lang
   SET expires_at = expires_at * 1000;
UPDATE webhook_idempotency
   SET created_at = created_at * 1000, expires_at = expires_at * 1000;

-- Maintenance deletes by these columns; without indexes each sweep scans.
CREATE INDEX idx_daily_usage_day ON user_daily_usage (day);
CREATE INDEX idx_rotations_issued ON session_rotations (issued_at);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);
CREATE INDEX idx_sessions_revoked ON sessions (revoked_at)
  WHERE revoked_at IS NOT NULL;
CREATE INDEX idx_otp_expires ON otp_codes (expires_at);
CREATE INDEX idx_claims_expires ON flutterwave_claims (expires_at);
CREATE INDEX idx_sync_cooldowns_last_push ON sync_cooldowns (last_push_at);
CREATE INDEX idx_push_tokens_inactive ON push_tokens (last_used_at)
  WHERE is_active = 0;
