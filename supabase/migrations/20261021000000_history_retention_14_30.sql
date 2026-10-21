-- Align cloud history retention with the shared retention policy:
--   free: 14 days, pro: 30 days (see packages/shared/src/retention.ts).
--
-- The previous function cut free history at 30 days and pro history at 365
-- days, which no longer matched the billing card or the mobile cache window.
-- On-device history remains a 7-day cache in the client and is not pruned here.

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
  v_cutoff_free := now() - interval '14 days';
  v_cutoff_pro  := now() - interval '30 days';

  -- Delete expired entries for non-pro users (free: 14 days)
  DELETE FROM public.history h
  WHERE h.created_at < v_cutoff_free
    AND NOT EXISTS (
      SELECT 1 FROM public.user_subscriptions us
      WHERE us.user_id = h.user_id
        AND us.status = 'active'
        AND (us.expires_at IS NULL OR us.expires_at > now())
    );
  GET DIAGNOSTICS v_deleted_free = ROW_COUNT;

  -- Delete expired entries for pro users (pro: 30 days)
  DELETE FROM public.history h
  WHERE h.created_at < v_cutoff_pro
    AND EXISTS (
      SELECT 1 FROM public.user_subscriptions us
      WHERE us.user_id = h.user_id
        AND us.status = 'active'
        AND (us.expires_at IS NULL OR us.expires_at > now())
    );
  GET DIAGNOSTICS v_deleted_pro = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted_free', v_deleted_free,
    'deleted_pro', v_deleted_pro
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_expired_history() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_history() TO service_role;

COMMENT ON FUNCTION public.cleanup_expired_history() IS
  'Deletes expired history rows based on plan retention limits (free: 14d, pro: 30d). Run daily.';
