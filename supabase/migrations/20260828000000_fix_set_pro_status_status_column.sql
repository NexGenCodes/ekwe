-- ─── Fix set_pro_status: write `status`, not the phantom `is_pro` column ──
--
-- The v4 RPC (20260818000000_dual_provider_billing.sql) was written against an
-- `is_pro` column that never existed in user_subscriptions (the DDL in
-- 20260416122000_create_user_subscriptions.sql only has `status`), and it never
-- wrote `status`. Every call therefore failed with:
--
--   column "is_pro" of relation "user_subscriptions" does not exist
--
-- …which surfaced to the Worker as a 400, so no Pro grant or revocation has
-- landed since v4 shipped. Both consumers predicate on the `status` column:
--   - custom_access_token_hook   (20260804000001 …): status = 'active'
--   - check_preflight            (20260817000000 …): status = 'active'
--
-- This migration restores the pre-v4 contract (status = 'active'/'inactive')
-- while keeping the v4 improvements: the provider column, the JWT metadata
-- write, the expiry guard, and the same 5-arg signature the Worker calls with
-- p_provider. CREATE OR REPLACE cannot change a signature, so the signature
-- (TEXT, UUID, BOOLEAN, TIMESTAMPTZ, TEXT) is preserved exactly and only the
-- body changes.

CREATE OR REPLACE FUNCTION public.set_pro_status(
  p_email TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_is_pro BOOLEAN DEFAULT FALSE,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_provider TEXT DEFAULT 'revenuecat'
)
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID;
  v_provider TEXT;
  v_status TEXT;
BEGIN
  -- Resolve the user ID from email if needed
  IF p_user_id IS NOT NULL THEN
    v_user_id := p_user_id;
  ELSIF p_email IS NOT NULL THEN
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE email = p_email
    LIMIT 1;

    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'No user found with email: %', p_email;
    END IF;
  ELSE
    RAISE EXCEPTION 'Either p_email or p_user_id must be provided';
  END IF;

  -- Normalize provider
  v_provider := COALESCE(p_provider, 'revenuecat');

  -- Map the boolean intent to the status column that every reader consumes.
  v_status := CASE WHEN p_is_pro THEN 'active' ELSE 'inactive' END;

  -- Upsert subscription: insert or update
  INSERT INTO user_subscriptions
    (user_id, status, provider, expires_at, updated_at)
  VALUES
    (v_user_id, v_status, v_provider, p_expires_at, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    status = EXCLUDED.status,
    -- Guard: only overwrite expires_at if the new value is non-null, OR if we're
    -- explicitly revoking (status = 'inactive'). This prevents a cancellation
    -- event from clobbering a future expiry set by a prior renewal event.
    expires_at = CASE
      WHEN EXCLUDED.expires_at IS NOT NULL THEN EXCLUDED.expires_at
      WHEN EXCLUDED.status = 'inactive' THEN EXCLUDED.expires_at  -- revoke: allow null
      ELSE user_subscriptions.expires_at  -- keep existing expiry
    END,
    provider = EXCLUDED.provider,
    updated_at = NOW();

  -- Update JWT metadata so the access-token hook picks up the change
  UPDATE auth.users
  SET raw_app_meta_data = jsonb_set(
    raw_app_meta_data,
    '{is_pro}',
    to_jsonb(p_is_pro)
  )
  WHERE id = v_user_id;

  RETURN TRUE;
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public';

-- Lock down to the service role only (webhook + billing verify use the
-- service-role key). Match the grants from the v4 migration.
REVOKE EXECUTE ON FUNCTION public.set_pro_status(TEXT, UUID, BOOLEAN, TIMESTAMPTZ, TEXT) FROM public, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.set_pro_status(TEXT, UUID, BOOLEAN, TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_pro_status(TEXT, UUID, BOOLEAN, TIMESTAMPTZ, TEXT) TO postgres;