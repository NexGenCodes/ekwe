-- Revoke EXECUTE on the push-token SECURITY DEFINER RPCs from the client
-- roles (anon, authenticated). The 20260913010000 hardening only revoked
-- from PUBLIC, but Supabase's default privileges grant EXECUTE to
-- anon/authenticated at function-creation time, so those explicit grants
-- survived. Only the worker (service_role) must be able to call these:
--   * get_active_push_tokens()   -- enumerates every active push token
--   * deactivate_push_token()    -- lets a caller disable arbitrary tokens
--   * cleanup_old_push_tokens()  -- bulk-writes token state
--   * upsert_push_token()        -- writes arbitrary rows (RLS bypassed:
--                                  SECURITY DEFINER, owner postgres)
-- Direct exec via Postgres (postgres owner, service_role) is preserved.

-- upsert_push_token (current signature: 4 args — p_user_id added in 20260818020000)
REVOKE EXECUTE ON FUNCTION upsert_push_token(
  TEXT, TEXT, TEXT, UUID
) FROM anon, authenticated;

-- get_active_push_tokens
REVOKE EXECUTE ON FUNCTION get_active_push_tokens()
  FROM anon, authenticated;

-- deactivate_push_token
REVOKE EXECUTE ON FUNCTION deactivate_push_token(TEXT)
  FROM anon, authenticated;

-- cleanup_old_push_tokens
REVOKE EXECUTE ON FUNCTION cleanup_old_push_tokens()
  FROM anon, authenticated;