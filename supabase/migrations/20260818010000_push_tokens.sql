-- ─── Push Token Storage ─────────────────────────────────────────
-- Stores Expo push tokens per device so the Worker can send APK
-- update notifications when a new version is built.
--
-- Migration: 20260818010000_push_tokens.sql

CREATE TABLE IF NOT EXISTS push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: tokens are registered at app launch, before the user signs in.
  -- Once the user is identified (future feature) the token can be attached.
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  push_token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'android'
    CHECK (platform IN ('android', 'ios')),
  app_version TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup: all active tokens for a user
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id
  ON push_tokens (user_id)
  WHERE is_active = TRUE;

-- Fast lookup: by token (for dedup / upsert)
CREATE INDEX IF NOT EXISTS idx_push_tokens_token
  ON push_tokens (push_token);

-- Enable RLS (service-role only — the Worker uses the service-role key)
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage push_tokens"
  ON push_tokens
  FOR ALL
  USING (TRUE);

-- RPC: upsert a push token (insert or update last_used_at if token exists)
-- user_id is optional because tokens register before the user signs in.
CREATE OR REPLACE FUNCTION upsert_push_token(
  p_push_token TEXT,
  p_platform TEXT DEFAULT 'android',
  p_app_version TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO push_tokens (push_token, platform, app_version, is_active, last_used_at)
  VALUES (p_push_token, p_platform, p_app_version, TRUE, NOW())
  ON CONFLICT (push_token) DO UPDATE SET
    platform = EXCLUDED.platform,
    app_version = EXCLUDED.app_version,
    is_active = TRUE,
    last_used_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION upsert_push_token TO service_role;

-- RPC: get all active push tokens (for sending notifications)
CREATE OR REPLACE FUNCTION get_active_push_tokens()
RETURNS TABLE (
  push_token TEXT,
  platform TEXT,
  user_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT pt.push_token, pt.platform, pt.user_id
  FROM push_tokens pt
  WHERE pt.is_active = TRUE
    AND pt.last_used_at > NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_active_push_tokens TO service_role;

-- RPC: deactivate a token (e.g. Expo reports DeviceNotRegistered).
CREATE OR REPLACE FUNCTION deactivate_push_token(p_push_token TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE push_tokens
  SET is_active = FALSE
  WHERE push_token = p_push_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION deactivate_push_token TO service_role;

-- RPC: deactivate tokens older than 90 days (cleanup)
CREATE OR REPLACE FUNCTION cleanup_old_push_tokens()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE push_tokens
  SET is_active = FALSE
  WHERE is_active = TRUE
    AND last_used_at < NOW() - INTERVAL '90 days';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION cleanup_old_push_tokens TO service_role;
