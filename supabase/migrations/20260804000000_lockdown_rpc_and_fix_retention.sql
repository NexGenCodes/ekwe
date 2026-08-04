-- Security lockdown + retention fix.
--
-- 1) check_preflight / increment_user_usage are SECURITY DEFINER but Postgres
--    grants EXECUTE to PUBLIC by default and neither function authenticated the
--    caller. Any caller could pass a victim's UUID and pin their cooldown
--    (rate-limit poisoning DoS). Restrict both to service_role and add an
--    auth.uid() guard. Both also lacked SET search_path (hijack protection) —
--    now set.
--
-- 2) cleanup_expired_history keyed pro status off raw_app_meta_data->>'is_pro',
--    which is never populated (pro lives in user_subscriptions), so every user
--    was treated as FREE and history was deleted after 30 days. Derive pro
--    status from user_subscriptions instead.

-- ─── check_preflight: service_role only + uid guard ─────────────────────────
CREATE OR REPLACE FUNCTION public.check_preflight(
  p_user_id UUID,
  p_tier TEXT,
  p_cooldown_seconds INT DEFAULT 3
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_last_request_at TIMESTAMP WITH TIME ZONE;
  v_time_since_last_req INTERVAL;
BEGIN
  -- Only service_role (the Worker) may act on behalf of another user.
  -- auth.uid() is NULL for service_role requests, so this only blocks
  -- authenticated callers who try to poison someone else's cooldown.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Upsert the user usage row for this month (kept for cooldown tracking)
  INSERT INTO public.user_usage (user_id, month, last_request_at, created_at, updated_at)
  VALUES (p_user_id, to_char(now(), 'YYYY-MM'), timezone('utc'::text, now() - interval '1 day'), now(), now())
  ON CONFLICT (user_id, month) DO NOTHING;

  -- Lock the row for update to prevent race conditions
  SELECT last_request_at
  INTO v_last_request_at
  FROM public.user_usage
  WHERE user_id = p_user_id AND month = to_char(now(), 'YYYY-MM')
  FOR UPDATE;

  -- Check Cooldown
  v_time_since_last_req := now() - v_last_request_at;
  IF EXTRACT(EPOCH FROM v_time_since_last_req) < p_cooldown_seconds THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'RATE_LIMIT',
      'cooldown_remaining', p_cooldown_seconds - EXTRACT(EPOCH FROM v_time_since_last_req)
    );
  END IF;

  -- Update last_request_at immediately to lock out other rapid requests
  UPDATE public.user_usage
  SET last_request_at = now()
  WHERE user_id = p_user_id AND month = to_char(now(), 'YYYY-MM');

  -- Allowed
  RETURN jsonb_build_object(
    'allowed', true,
    'tier_active', p_tier
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_preflight(UUID, TEXT, INT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_preflight(UUID, TEXT, INT) TO service_role;

-- ─── increment_user_usage: service_role only + uid guard ────────────────────
CREATE OR REPLACE FUNCTION public.increment_user_usage(p_user_id uuid, p_month text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  current_count integer;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.user_usage (user_id, month, usage_count, created_at, updated_at)
  VALUES (p_user_id, p_month, 1, now(), now())
  ON CONFLICT (user_id, month) DO UPDATE
  SET
    usage_count = public.user_usage.usage_count + 1,
    updated_at = now()
  RETURNING usage_count INTO current_count;

  RETURN current_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_user_usage(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_user_usage(uuid, text) TO service_role;

-- ─── cleanup_expired_history: derive pro from user_subscriptions ─────────────
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

  -- Delete expired entries for non-pro users (free: 30 days)
  DELETE FROM public.history h
  WHERE h.created_at < v_cutoff_free
    AND NOT EXISTS (
      SELECT 1 FROM public.user_subscriptions us
      WHERE us.user_id = h.user_id
        AND us.status = 'active'
        AND (us.expires_at IS NULL OR us.expires_at > now())
    );
  GET DIAGNOSTICS v_deleted_free = ROW_COUNT;

  -- Delete expired entries for pro users (pro: 365 days)
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

-- Grant execution to service_role only (Worker cron calls this daily)
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_history() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_history() TO service_role;

COMMENT ON FUNCTION public.cleanup_expired_history() IS
  'Deletes expired history rows based on plan retention limits (free: 30d, pro: 365d). Run daily.';
