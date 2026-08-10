-- Daily per-user usage quota.
--
-- Decided scope (worker pipeline is near-free):
--   * Metric: daily request count, UTC day key, counted per request TYPE
--     (translate vs transcribe) so a user can exhaust neither pool by
--     hammering only one endpoint.
--   * Consume timing: only BILLABLE provider successes count. KV cache hits
--     (replays of the same text/audio) and guard failures never consume.
--     Consumption is a fire-and-forget RPC the Worker awaits out-of-band so
--     response latency is unchanged.
--   * Overflow safety: `check_preflight` still holds the user_usage row lock
--     for cooldown, and the 1/N-second cooldowns bound per-user concurrency
--     to ~1 request per few seconds, so check-then-consumer races can only
--     overshoot the daily cap by a couple of requests at most.
--
-- The numeric limits live in `packages/shared/plans.ts` and are PASSED IN by
-- the Worker on every call (never hard-coded in SQL), so plan changes are a
-- one-line deploy instead of a migration.

-- ─── Daily usage table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_daily_usage (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day text NOT NULL,
  translate_count integer NOT NULL DEFAULT 0,
  transcribe_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (user_id, day)
);

ALTER TABLE public.user_daily_usage ENABLE ROW LEVEL SECURITY;

-- Users may inspect their own usage (drives any future "X left today" UI).
CREATE POLICY "Users can view their own daily usage"
  ON public.user_daily_usage FOR SELECT
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.user_daily_usage IS
  'Daily per-type usage counters (translate/transcribe), UTC day key. Writes only via service_role RPC.';

-- ─── check_preflight: add per-type daily quota check ─────────────────
-- Replaces the old 3-arg signature (UUID, TEXT, INT). Upsert/cooldown logic
-- is unchanged; the quota check is appended in the same serialized path.
DROP FUNCTION IF EXISTS public.check_preflight(uuid, text, int);

CREATE OR REPLACE FUNCTION public.check_preflight(
  p_user_id UUID,
  p_tier TEXT,
  p_cooldown_seconds INT DEFAULT 3,
  p_type TEXT DEFAULT 'translate',
  p_daily_limit INT DEFAULT 0
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

  -- Daily quota: worker passes the numeric limit so SQL never hard-codes
  -- plan numbers. p_daily_limit <= 0 means "no quota" (safety valve).
  v_day := to_char(timezone('utc', now()), 'YYYY-MM-DD');
  v_used := NULL;
  IF p_daily_limit > 0 AND p_type = 'translate' THEN
    SELECT translate_count INTO v_used
    FROM public.user_daily_usage
    WHERE user_id = p_user_id AND day = v_day;
  ELSIF p_daily_limit > 0 AND p_type = 'transcribe' THEN
    SELECT transcribe_count INTO v_used
    FROM public.user_daily_usage
    WHERE user_id = p_user_id AND day = v_day;
  END IF;

  IF v_used IS NOT NULL AND v_used >= p_daily_limit THEN
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
    'quota_total', p_daily_limit,
    'quota_remaining', GREATEST(p_daily_limit - COALESCE(v_used, 0), 0)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_preflight(UUID, TEXT, INT, TEXT, INT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_preflight(UUID, TEXT, INT, TEXT, INT) TO service_role;

-- ─── consume_usage: atomic +1 for a request type's daily counter ──────
CREATE OR REPLACE FUNCTION public.consume_usage(p_user_id uuid, p_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_day TEXT := to_char(timezone('utc', now()), 'YYYY-MM-DD');
  v_count INT;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.user_daily_usage (user_id, day, translate_count, transcribe_count, updated_at)
  VALUES (
    p_user_id, v_day,
    CASE WHEN p_type = 'translate' THEN 1 ELSE 0 END,
    CASE WHEN p_type = 'transcribe' THEN 1 ELSE 0 END,
    now()
  )
  ON CONFLICT (user_id, day) DO UPDATE
  SET
    translate_count = CASE WHEN p_type = 'translate' THEN public.user_daily_usage.translate_count + 1 ELSE public.user_daily_usage.translate_count END,
    transcribe_count = CASE WHEN p_type = 'transcribe' THEN public.user_daily_usage.transcribe_count + 1 ELSE public.user_daily_usage.transcribe_count END,
    updated_at = now()
  RETURNING CASE WHEN p_type = 'translate' THEN translate_count ELSE transcribe_count END INTO v_count;

  RETURN jsonb_build_object('count', v_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_usage(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_usage(uuid, text) TO service_role;

COMMENT ON FUNCTION public.consume_usage(uuid, text) IS
  'Atomically increments today''s counter for the given request type. Service_role only.';