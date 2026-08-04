-- Extend set_pro_status with an optional expiry timestamp so time-based
-- subscription providers (RevenueCat) can record when pro lapses. The access
-- token hook honors expires_at, so expired subscriptions stop minting is_pro.
-- Paystack/Flutterwave (one-time charges) pass NULL → treated as lifetime.

CREATE OR REPLACE FUNCTION public.set_pro_status(
  p_email TEXT,
  p_user_id UUID,
  p_is_pro BOOLEAN,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_user_id UUID;
  v_status TEXT;
BEGIN
  -- 1. Find user ID from email if p_user_id is not provided
  IF p_user_id IS NULL THEN
    SELECT id INTO v_user_id FROM auth.users WHERE email = p_email;
  ELSE
    v_user_id := p_user_id;
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- 2. Determine target status
  v_status := CASE WHEN p_is_pro THEN 'active' ELSE 'inactive' END;

  -- 3. Insert or update user_subscriptions status
  INSERT INTO public.user_subscriptions (user_id, status, platform, expires_at, updated_at)
  VALUES (v_user_id, v_status, 'web', p_expires_at, now())
  ON CONFLICT (user_id)
  DO UPDATE SET
    status = v_status,
    expires_at = CASE WHEN p_expires_at IS NULL THEN public.user_subscriptions.expires_at ELSE p_expires_at END,
    updated_at = now();
END;
$$;

-- Grant execute permission to the service role only (the Worker calls this via
-- the service_role key). Revoke from all client-facing roles to prevent abuse.
REVOKE EXECUTE ON FUNCTION public.set_pro_status(TEXT, UUID, BOOLEAN, TIMESTAMPTZ) FROM public, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.set_pro_status(TEXT, UUID, BOOLEAN, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_pro_status(TEXT, UUID, BOOLEAN, TIMESTAMPTZ) TO postgres;
