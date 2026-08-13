-- Pro "unlimited" with an abuse throttle.
--
-- PREMIUM now passes a daily limit of 0 ("unlimited"): the Worker NEVER
-- hard-blocks a Pro request. Instead, once a Pro user's day count crosses the
-- throttle threshold, they are served FREE-tier limits until UTC midnight —
-- a 3s cooldown (vs 1s) instead of a denial, so automation is slowed rather
-- than blocked and honest "Unlimited" marketing stays true. The free tier
-- keeps its hard 25/day cap and passes a 0 throttle threshold.
--
-- All numeric limits keep coming from `packages/shared/plans.ts` (SSOT) and
-- are PASSED IN on every call; SQL never hard-codes plan numbers.

-- ─── check_preflight: add throttle threshold + throttled cooldown ─────
-- Signature grows from (UUID, TEXT, INT, TEXT, INT) to include
-- p_throttle_threshold and p_throttle_cooldown_seconds. The daily-count read
-- moves before the cooldown check so the throttle can pick the effective
-- cooldown. The hard quota check is unchanged (only the FREE tier uses it).
DROP FUNCTION IF EXISTS public.check_preflight(uuid, text, int, text, int);

CREATE OR REPLACE FUNCTION public.check_preflight(
  p_user_id UUID,
  p_tier TEXT,
  p_cooldown_seconds INT DEFAULT 3,
  p_type TEXT DEFAULT 'translate',
  p_daily_limit INT DEFAULT 0,
  p_throttle_threshold INT DEFAULT 0,
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
BEGIN
  -- Only service_role (the Worker) may act on behalf of another user; the
  -- same guard blocks authenticated callers from poisoning cooldowns/quotas.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

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
  -- cooldown below. p_daily_limit <= 0 means "no quota" (safety valve) and
  -- p_throttle_threshold <= 0 means "no throttle".
  v_day := to_char(timezone('utc', now()), 'YYYY-MM-DD');
  v_used := NULL;
  IF (p_daily_limit > 0 OR p_throttle_threshold > 0) AND p_type = 'translate' THEN
    SELECT translate_count INTO v_used
    FROM public.user_daily_usage
    WHERE user_id = p_user_id AND day = v_day;
  ELSIF (p_daily_limit > 0 OR p_throttle_threshold > 0) AND p_type = 'transcribe' THEN
    SELECT transcribe_count INTO v_used
    FROM public.user_daily_usage
    WHERE user_id = p_user_id AND day = v_day;
  END IF;

  -- Throttled users are slowed (free-tier cooldown), never denied.
  v_throttled := p_throttle_threshold > 0
    AND v_used IS NOT NULL
    AND v_used >= p_throttle_threshold;
  v_cooldown := CASE WHEN v_throttled THEN p_throttle_cooldown_seconds ELSE p_cooldown_seconds END;

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
  IF v_used IS NOT NULL AND p_daily_limit > 0 AND v_used >= p_daily_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'QUOTA_EXCEEDED',
      'quota_total', p_daily_limit,
      'quota_remaining', 0
    );
  END IF;

  -- Allowed
  RETURN jsonb_build_object(
    'allowed', true,
    'tier_active', p_tier,
    'throttled', v_throttled,
    'quota_total', p_daily_limit,
    'quota_remaining', GREATEST(p_daily_limit - COALESCE(v_used, 0), 0)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_preflight(UUID, TEXT, INT, TEXT, INT, INT, INT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_preflight(UUID, TEXT, INT, TEXT, INT, INT, INT) TO service_role;

COMMENT ON FUNCTION public.check_preflight(UUID, TEXT, INT, TEXT, INT, INT, INT) IS
  'Cooldown + daily quota gate. PREMIUM passes daily_limit=0 (unlimited) and a throttle threshold; over the threshold the request is marked throttled and gets the slower free cooldown until UTC midnight, but is never denied. Service_role only.';
