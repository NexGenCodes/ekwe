-- admin_clear_all_history: Dev/admin utility that permanently deletes EVERY
-- history row across ALL users — not just the caller's.
--
-- Security: service_role only (the Worker/dev can invoke it). Authenticated
-- users can never wipe other users' history, mirroring the lockdown applied to
-- check_preflight / increment_user_usage.
--
-- Usage:
--   SELECT public.admin_clear_all_history();
--
-- Returns the number of rows deleted.

CREATE OR REPLACE FUNCTION public.admin_clear_all_history()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  -- Only service_role (admin/dev) may wipe everyone's history.
  -- auth.uid() is NULL for service_role requests, so this only blocks
  -- authenticated callers who try to mass-delete other users' rows.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  DELETE FROM public.history;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_clear_all_history() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clear_all_history() TO service_role;

COMMENT ON FUNCTION public.admin_clear_all_history() IS
  'Permanently deletes every history row across all users. service_role only.';