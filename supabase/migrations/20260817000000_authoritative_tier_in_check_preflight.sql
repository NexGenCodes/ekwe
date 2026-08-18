-- Make check_preflight the authoritative tier gate.
--
-- Previously the Worker passed `p_tier` (from the JWT's app_metadata.is_pro)
-- and the RPC echoed it straight back as `tier_active`. A user whose
-- RevenueCat subscription had landed in `user_subscriptions` but whose JWT was
-- stale (webhook delay, long-lived access token) was therefore still
-- cooldown/quota-gated as FREE.
--
-- Now the RPC derives the authoritative tier itself from user_subscriptions
-- using the SAME predicate as the custom access token hook
-- (status='active' AND (expires_at IS NULL OR expires_at > now())), returns it
-- as `tier_active`, and applies the *effective* tier's limits. The Worker
-- still owns the numeric limits (SSOT in packages/shared/plans.ts) and passes
-- BOTH tiers' values so plan changes never require a migration:
--
--   p_free_cooldown_seconds (3)      p_free_daily_limit (25)
--   p_premium_cooldown_seconds (1)   p_premium_daily_limit (0 = unlimited)
--   p_premium_throttle_threshold (500) p_throttle_cooldown_seconds (3 = free cooldown)
--
-- The free tier never throttles (its threshold is implicitly 0), so no free
-- throttle parameter is needed. A throttled PREMIUM user keeps the free
-- cooldown until UTC midnight but is never denied.

-- ─── check_preflight: authoritative tier + dual-tier limits ─────
-- Signature grows from (UUID, TEXT, INT, TEXT, INT, INT, INT) to
-- (UUID, TEXT, INT, INT, INT, INT, INT, INT): the tier is no longer an input
-- (the DB decides it) and the Worker passes each tier's limits explicitly.
DROP FUNCTION IF EXISTS public.check_preflight(uuid, text, int, text, int, int, int);

CREATE OR REPLACE FUNCTION public.check_preflight(
  p_user_id UUID,
  p_type TEXT DEFAULT 'translate',
  p_free_cooldown_seconds INT DEFAULT 3,
  p_free_daily_limit INT DEFAULT 25,
  p_premium_cooldown_seconds INT DEFAULT 1,
  p_premium_daily_limit INT DEFAULT 0,
  p_premium_throttle_threshold INT DEFAULT 500,
  p_throttle_cooldown_seconds INT DEFAULT 3
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_last_request_at TIMESTAMP WITH TIME ZONE;
  v_time_since_last_req INTERVAL;
  v_day TEXT;
  v_used INT;
  v_throttled BOOLEAN;
  v_cooldown INT;
  v_daily_limit INT;
  v_throttle_threshold INT;
  v_is_pro BOOLEAN;
BEGIN
  -- Only service_role (the Worker) may act on behalf of another user; the
  -- same guard blocks authenticated callers from poisoning cooldowns/quotas.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Authoritative tier: same predicate as the custom access token hook
  -- (20260804000001_harden_access_token_hook_expiry.sql). NULL expires_at =
  -- lifetime (Paystack/Flutterwave charge).
  SELECT EXISTS (
    SELECT 1
    FROM public.user_subscriptions us
    WHERE us.user_id = p_user_id
      AND us.status = 'active'
      AND (us.expires_at IS NULL OR us.expires_at > now())
  ) INTO v_is_pro;

  -- Effective limits come from the DB-backed tier, not the (possibly stale)
  -- JWT tier. The free tier never throttles (threshold 0 is implicit).
  v_daily_limit := CASE WHEN v_is_pro THEN p_premium_daily_limit ELSE p_free_daily_limit END;
  v_throttle_threshold := CASE WHEN v_is_pro THEN p_premium_throttle_threshold ELSE 0 END;

  -- Upsert the user usage row for this month (kept for cooldown tracking)
  INSERT INTO public.user_usage (user_id, month, last_request_at, created_at, updated_at)
  VALUES (p_user_id, to_char(now(), 'YYYY-MM'), timezone('utc'::text, now() - interval '1 day'), now(), now())
  ON CONFLICT (user_id, month) DO NOTHING;

  -- Lock the row for update to serialize concurrent requests
  SELECT last_request_at
  INTO v_last_request_at
  FROM public.user_usage
  WHERE user_id = p_user_id AND month = to_char(now(), 'YYYY-MM')
  FOR UPDATE;

  -- Read the day count up-front so the throttle can choose the effective
  -- cooldown below. v_daily_limit <= 0 means "no quota" (safety valve) and
  -- v_throttle_threshold <= 0 means "no throttle".
  v_day := to_char(timezone('utc', now()), 'YYYY-MM-DD');
  v_used := NULL;
  IF (v_daily_limit > 0 OR v_throttle_threshold > 0) AND p_type = 'translate' THEN
    SELECT translate_count INTO v_used
    FROM public.user_daily_usage
    WHERE user_id = p_user_id AND day = v_day;
  ELSIF (v_daily_limit > 0 OR v_throttle_threshold > 0) AND p_type = 'transcribe' THEN
    SELECT transcribe_count INTO v_used
    FROM public.user_daily_usage
    WHERE user_id = p_user_id AND day = v_day;
  END IF;

  -- Throttled users are slowed (free-tier cooldown), never denied.
  v_throttled := v_throttle_threshold > 0
    AND v_used IS NOT NULL
    AND v_used >= v_throttle_threshold;
  v_cooldown := CASE
    WHEN v_throttled THEN p_throttle_cooldown_seconds
    ELSE CASE WHEN v_is_pro THEN p_premium_cooldown_seconds ELSE p_free_cooldown_seconds END
  END;

  -- Check Cooldown (effective cooldown accounts for throttling)
  v_time_since_last_req := now() - v_last_request_at;
  IF EXTRACT(EPOCH FROM v_time_since_last_req) < v_cooldown THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'RATE_LIMIT',
      'cooldown_remaining', v_cooldown - EXTRACT(EPOCH FROM v_time_since_last_req)
    );
  END IF;

  -- Update last_request_at immediately to lock out other rapid requests
  UPDATE public.user_usage
  SET last_request_at = now()
  WHERE user_id = p_user_id AND month = to_char(now(), 'YYYY-MM');

  -- Hard daily quota (FREE tier only; PREMIUM passes 0 = no quota).
  IF v_used IS NOT NULL AND v_daily_limit > 0 AND v_used >= v_daily_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'QUOTA_EXCEEDED',
      'quota_total', v_daily_limit,
      'quota_remaining', 0
    );
  END IF;

  -- Allowed
  RETURN jsonb_build_object(
    'allowed', true,
    'tier_active', CASE WHEN v_is_pro THEN 'PREMIUM' ELSE 'FREE' END,
    'throttled', v_throttled,
    'quota_total', v_daily_limit,
    'quota_remaining', GREATEST(v_daily_limit - COALESCE(v_used, 0), 0)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_preflight(UUID, TEXT, INT, INT, INT, INT, INT, INT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_preflight(UUID, TEXT, INT, INT, INT, INT, INT, INT) TO service_role;

COMMENT ON FUNCTION public.check_preflight(UUID, TEXT, INT, INT, INT, INT, INT, INT) IS
  'Cooldown + daily quota gate with the authoritative tier derived from user_subscriptions (same predicate as the access token hook). The Worker passes both FREE and PREMIUM limits; the RPC applies the effective tier''s. A throttled PREMIUM request gets the free cooldown but is never denied. Service_role only.';
