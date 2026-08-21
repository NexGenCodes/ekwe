-- ─── Add user_id to upsert_push_token ─────────────────────────
-- The existing upsert_push_token RPC ignores user_id, so tokens are
-- registered without ownership. This migration adds an optional
-- p_user_id parameter so the client can attach the signed-in user
-- when re-registering after auth.
--
-- Migration: 20260818020000_add_user_id_to_upsert_push_token.sql

DROP FUNCTION IF EXISTS upsert_push_token(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION upsert_push_token(
  p_push_token TEXT,
  p_platform TEXT DEFAULT 'android',
  p_app_version TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO push_tokens (push_token, platform, app_version, user_id, is_active, last_used_at)
  VALUES (p_push_token, p_platform, p_app_version, p_user_id, TRUE, NOW())
  ON CONFLICT (push_token) DO UPDATE SET
    platform = EXCLUDED.platform,
    app_version = EXCLUDED.app_version,
    user_id = COALESCE(EXCLUDED.user_id, push_tokens.user_id),
    is_active = TRUE,
    last_used_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION upsert_push_token TO service_role;
