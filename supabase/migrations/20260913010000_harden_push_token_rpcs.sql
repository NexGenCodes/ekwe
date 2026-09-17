-- Harden push-token SECURITY DEFINER RPCs created in 2026081801000000.
-- 1) Lock search_path to 'public' so a malicious user can't inject a schema
--    that shadows the push_tokens table.
-- 2) Revoke EXECUTE from PUBLIC — only service_role needs access.

-- upsert_push_token (current signature: 4 args — p_user_id added in 20260818020000)
ALTER FUNCTION upsert_push_token(
  p_push_token TEXT,
  p_platform TEXT,
  p_app_version TEXT,
  p_user_id UUID
)
  SET search_path = 'public';

REVOKE EXECUTE ON FUNCTION upsert_push_token(
  TEXT, TEXT, TEXT, UUID
) FROM PUBLIC;

-- get_active_push_tokens
ALTER FUNCTION get_active_push_tokens()
  SET search_path = 'public';

REVOKE EXECUTE ON FUNCTION get_active_push_tokens()
  FROM PUBLIC;

-- deactivate_push_token
ALTER FUNCTION deactivate_push_token(p_push_token TEXT)
  SET search_path = 'public';

REVOKE EXECUTE ON FUNCTION deactivate_push_token(TEXT)
  FROM PUBLIC;

-- cleanup_old_push_tokens
ALTER FUNCTION cleanup_old_push_tokens()
  SET search_path = 'public';

REVOKE EXECUTE ON FUNCTION cleanup_old_push_tokens()
  FROM PUBLIC;
