-- Cleanup expired history entries based on plan retention limits
-- FREE users: 30 days
-- PREMIUM users: 365 days
--
-- This function is designed to be called:
--  1. By pg_cron (Supabase scheduled job)
--  2. By Cloudflare Worker cron trigger
--  3. Manually via SQL console

CREATE OR REPLACE FUNCTION public.cleanup_expired_history()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_deleted_free BIGINT;
  v_deleted_pro  BIGINT;
  v_cutoff_free  TIMESTAMPTZ;
  v_cutoff_pro   TIMESTAMPTZ;
BEGIN
  v_cutoff_free := now() - interval '30 days';
  v_cutoff_pro  := now() - interval '365 days';

  -- Delete free users' expired entries
  DELETE FROM public.history h
  WHERE h.created_at < v_cutoff_free
    AND h.user_id IN (
      SELECT id FROM auth.users
      WHERE raw_app_meta_data->>'is_pro' IS DISTINCT FROM 'true'
         OR raw_app_meta_data->>'is_pro' IS NULL
    );
  GET DIAGNOSTICS v_deleted_free = ROW_COUNT;

  -- Delete premium users' expired entries
  DELETE FROM public.history h
  WHERE h.created_at < v_cutoff_pro
    AND h.user_id IN (
      SELECT id FROM auth.users
      WHERE raw_app_meta_data->>'is_pro' = 'true'
    );
  GET DIAGNOSTICS v_deleted_pro = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted_free', v_deleted_free,
    'deleted_pro', v_deleted_pro
  );
END;
$$;

-- Grant execution to service_role so the Worker cron can call it
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_history() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_history() TO service_role;

COMMENT ON FUNCTION public.cleanup_expired_history() IS
  'Deletes expired history rows based on plan retention limits (free: 30d, pro: 365d). Run daily.';
