-- Extend set_pro_status with a payment reference parameter so the
-- Flutterwave tx_ref is persisted on user_subscriptions. This eliminates
-- the need for a separate transaction_ledgers table — the reconciliation
-- job can check user_subscriptions.flutterwave_tx_ref directly.
--
-- Signature changes from 5 args to 6 (backward-compatible via DEFAULT NULL).

DROP FUNCTION IF EXISTS public.set_pro_status(TEXT, UUID, BOOLEAN, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION public.set_pro_status(
  p_email TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_is_pro BOOLEAN DEFAULT FALSE,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_provider TEXT DEFAULT 'revenuecat',
  p_payment_ref TEXT DEFAULT NULL
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
    (user_id, status, provider, expires_at, flutterwave_tx_ref, updated_at)
  VALUES
    (v_user_id, v_status, v_provider, p_expires_at, p_payment_ref, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    status = EXCLUDED.status,
    expires_at = CASE
      WHEN EXCLUDED.expires_at IS NOT NULL THEN EXCLUDED.expires_at
      WHEN EXCLUDED.status = 'inactive' THEN EXCLUDED.expires_at
      ELSE user_subscriptions.expires_at
    END,
    provider = EXCLUDED.provider,
    flutterwave_tx_ref = COALESCE(EXCLUDED.flutterwave_tx_ref, user_subscriptions.flutterwave_tx_ref),
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

REVOKE EXECUTE ON FUNCTION public.set_pro_status(TEXT, UUID, BOOLEAN, TIMESTAMPTZ, TEXT, TEXT) FROM public, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.set_pro_status(TEXT, UUID, BOOLEAN, TIMESTAMPTZ, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_pro_status(TEXT, UUID, BOOLEAN, TIMESTAMPTZ, TEXT, TEXT) TO postgres;
