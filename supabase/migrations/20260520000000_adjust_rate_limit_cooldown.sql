-- Adjust rate limit cooldowns for better UX
-- FREE tier: 3s cooldown between requests, unlimited monthly
-- PREMIUM tier: 1s cooldown, 1000 transactions/month hard cap (no silent fallback)

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
BEGIN
  -- Determine cooldowns and limits based on tier
  IF p_tier = 'PREMIUM' OR p_tier = 'CAPPED_PREMIUM' THEN
    v_cooldown_seconds := 1;
    v_limit := 1000;
  ELSE
    v_cooldown_seconds := 3;
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

  -- Hard block: monthly limit exceeded
  IF v_limit > 0 AND v_transactions_used >= v_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'MONTHLY_LIMIT',
      'cooldown_remaining', 0
    );
  END IF;

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
    'tier_active', p_tier,
    'is_fallback', false,
    'transactions_used', v_transactions_used
  );
END;
$$;
