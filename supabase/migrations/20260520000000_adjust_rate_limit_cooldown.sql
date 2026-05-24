-- Adjust rate limit cooldowns for better UX
-- FREE tier: reduced from 12s to 3s cooldown between requests
-- PREMIUM tier: reduced from 2s to 1s

CREATE OR REPLACE FUNCTION public.check_preflight(p_user_id UUID, p_tier TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_last_request_at TIMESTAMP WITH TIME ZONE;
  v_transactions_used NUMERIC;
  v_cooldown_seconds INT;
  v_limit NUMERIC;
  v_time_since_last_req INTERVAL;
  v_is_fallback BOOLEAN := false;
  v_tier_active TEXT := p_tier;
BEGIN
  -- Determine cooldowns and limits based on tier
  IF p_tier = 'PREMIUM' THEN
    v_cooldown_seconds := 1;  -- Was 2, now 1s for faster response
    v_limit := 200;
  ELSE
    v_cooldown_seconds := 3;  -- Was 12, now 3s - much more responsive
    v_limit := -1; -- Unlimited
  END IF;

  -- Upsert the user usage row for this month
  INSERT INTO public.user_usage (user_id, month, transactions_used, last_request_at, created_at, updated_at)
  VALUES (p_user_id, to_char(now(), 'YYYY-MM'), 0, timezone('utc'::text, now() - interval '1 day'), now(), now())
  ON CONFLICT (user_id, month) DO NOTHING;

  -- Lock the row for update to prevent race conditions
  SELECT last_request_at, transactions_used 
  INTO v_last_request_at, v_transactions_used
  FROM public.user_usage 
  WHERE user_id = p_user_id AND month = to_char(now(), 'YYYY-MM')
  FOR UPDATE;

  -- Check Fallback for Premium
  IF p_tier = 'PREMIUM' AND v_transactions_used >= v_limit THEN
    v_cooldown_seconds := 3;
    v_is_fallback := true;
    v_tier_active := 'FREE';
  END IF;

  -- Check Cooldown
  v_time_since_last_req := now() - v_last_request_at;
  IF EXTRACT(EPOCH FROM v_time_since_last_req) < v_cooldown_seconds THEN
    -- Rate limited
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
    'tier_active', v_tier_active,
    'is_fallback', v_is_fallback,
    'transactions_used', v_transactions_used
  );
END;
$$;