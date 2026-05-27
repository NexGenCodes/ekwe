-- Migration to create the set_pro_status RPC function
-- This function is used by the Cloudflare Worker webhook to securely update
-- the user's subscription status in the database using the service role key.

CREATE OR REPLACE FUNCTION public.set_pro_status(
  p_email TEXT,
  p_user_id UUID,
  p_is_pro BOOLEAN
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
  INSERT INTO public.user_subscriptions (user_id, status, platform, updated_at)
  VALUES (v_user_id, v_status, 'web', now())
  ON CONFLICT (user_id)
  DO UPDATE SET
    status = v_status,
    updated_at = now();
END;
$$;

-- Grant execute permission to authenticated/anon roles if needed, or service role only.
-- Since the Worker calls this RPC using the service_role key, it runs with admin rights.
-- Let's explicitly grant access to the postgres and service_role.
GRANT EXECUTE ON FUNCTION public.set_pro_status(TEXT, UUID, BOOLEAN) TO postgres;
GRANT EXECUTE ON FUNCTION public.set_pro_status(TEXT, UUID, BOOLEAN) TO service_role;

-- Revoke execute from public/authenticated/anon to prevent abuse
REVOKE EXECUTE ON FUNCTION public.set_pro_status(TEXT, UUID, BOOLEAN) FROM public, authenticated, anon;
