-- Remove transaction-based billing: both tiers are now unlimited.
-- check_preflight only enforces cooldown; postflight_deduction is removed.
--
-- Plan config (limits, pipelines, pricing) is now in worker/src/app-config.ts
-- — the single source of truth served by GET /plan-config.

-- Simplify check_preflight: cooldown only, no transaction limits
CREATE OR REPLACE FUNCTION public.check_preflight(p_user_id UUID, p_tier TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_last_request_at TIMESTAMP WITH TIME ZONE;
  v_cooldown_seconds INT;
  v_time_since_last_req INTERVAL;
BEGIN
  -- Cooldown: FREE=3s, PREMIUM=1s (mirrors worker/src/app-config.ts)
  IF p_tier = 'PREMIUM' THEN
    v_cooldown_seconds := 1;
  ELSE
    v_cooldown_seconds := 3;
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
  IF EXTRACT(EPOCH FROM v_time_since_last_req) < v_cooldown_seconds THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'RATE_LIMIT',
      'cooldown_remaining', v_cooldown_seconds - EXTRACT(EPOCH FROM v_time_since_last_req)
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

-- Remove postflight_deduction (no longer needed)
DROP FUNCTION IF EXISTS public.postflight_deduction;
