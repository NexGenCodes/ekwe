-- Make Flutterwave payment redemption idempotent.
--
-- `set_pro_status` unconditionally overwrites `user_subscriptions.expires_at`,
-- and `/billing/verify-transaction` derives that value from `Date.now()` on
-- every call. Nothing recorded that a `flw_ref` had already been redeemed, so a
-- paying user could replay one successful transaction_id and have `expires_at`
-- pushed forward again on each attempt: one monthly purchase granted indefinite
-- Pro.
--
-- The webhook path was never exposed to this. `handleWebhook` claims a D1
-- idempotency key before processing and releases it when the application is only
-- partially applied, so a retried `charge.successful` is dropped as a duplicate.
-- `/billing/verify-transaction` is called directly by the client after the
-- payment redirect, with no webhook behind it, which is why it needs its own.
--
-- The expiry is computed here rather than in the worker for two reasons. The
-- value written to user_subscriptions is then the value the ledger recorded, so
-- a replay reports the period it actually granted. And it fixes a bug the worker
-- could not express: a renewal bought before the current term ends was writing
-- `now() + 30d` over an expiry further in the future, shortening the subscription
-- it was supposed to extend.
--
-- set_pro_status is untouched. It stays the writer every other caller
-- (RevenueCat, webhooks) already depends on, and the verify path now passes this
-- RPC's expiry through it unchanged.

CREATE TABLE IF NOT EXISTS public.flutterwave_transaction_claims (
  flw_ref    TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tx_ref     TEXT NOT NULL,
  amount     NUMERIC(12, 2),
  currency   TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reconciliation reports on claims per user; a chargeback or dispute resolves
-- through the same lookup.
CREATE INDEX IF NOT EXISTS idx_fw_claims_user
  ON public.flutterwave_transaction_claims (user_id, claimed_at DESC);

COMMENT ON TABLE public.flutterwave_transaction_claims IS
  'One row per redeemed Flutterwave transaction. The primary key on flw_ref is the replay guard: a transaction can extend a subscription at most once. Written only by the service_role through claim_flutterwave_transaction.';

CREATE OR REPLACE FUNCTION public.claim_flutterwave_transaction(
  p_flw_ref TEXT,
  p_user_id UUID,
  p_tx_ref TEXT DEFAULT NULL,
  p_amount NUMERIC DEFAULT NULL,
  p_currency TEXT DEFAULT NULL,
  p_period TEXT DEFAULT 'monthly',
  p_monthly_days INT DEFAULT 30,
  p_annual_days INT DEFAULT 365
)
RETURNS TABLE(expires_at TIMESTAMPTZ, should_activate BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_days   INT;
  v_expiry TIMESTAMPTZ;
  v_claimed BOOLEAN;
BEGIN
  IF p_flw_ref IS NULL OR p_flw_ref = '' THEN
    RAISE EXCEPTION 'p_flw_ref is required';
  END IF;

  v_days := CASE WHEN p_period = 'annual' THEN p_annual_days ELSE p_monthly_days END;

  -- Extend from whatever remains of an active term, otherwise start from now.
  -- GREATEST(..., now()) keeps an already-lapsed or NULL expiry from becoming
  -- the base, which would produce a date in the past.
  v_expiry := GREATEST(
    COALESCE(
      (
        SELECT us.expires_at
        FROM public.user_subscriptions us
        WHERE us.user_id = p_user_id
          AND us.status = 'active'
          AND us.expires_at > now()
      ),
      now()
    ),
    now()
  ) + make_interval(days => v_days);

  INSERT INTO public.flutterwave_transaction_claims
    (flw_ref, user_id, tx_ref, amount, currency, expires_at)
  VALUES
    (p_flw_ref, p_user_id, COALESCE(p_tx_ref, ''), p_amount, p_currency, v_expiry)
  ON CONFLICT (flw_ref) DO NOTHING
  RETURNING TRUE INTO v_claimed;

  -- First redemption of this transaction: the caller applies the expiry.
  IF v_claimed THEN
    RETURN QUERY SELECT v_expiry, TRUE;
    RETURN;
  END IF;

  -- Already redeemed. Hand back the expiry from the first claim so the caller
  -- can still answer the client truthfully, and flag it as a duplicate so no
  -- second period is granted.
  SELECT ctc.expires_at INTO v_expiry
  FROM public.flutterwave_transaction_claims ctc
  WHERE ctc.flw_ref = p_flw_ref;

  RETURN QUERY SELECT v_expiry, FALSE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_flutterwave_transaction(TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, INT, INT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_flutterwave_transaction(TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_flutterwave_transaction(TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, INT, INT) TO postgres;

COMMENT ON FUNCTION public.claim_flutterwave_transaction(TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, INT, INT) IS
  'Atomically records that a Flutterwave transaction has been redeemed and returns (expires_at, should_activate). should_activate is true only for the first claim of a flw_ref; a replay returns false with the originally granted expiry, and the caller must not write it again. Extends from the remaining term of an active subscription rather than from now(). Service_role only.';

-- ─── bulk push-token deactivation ──────────────────────────────────────
-- /admin/update/notify calls deactivate_push_token once per DeviceNotRegistered
-- ticket. A launch that invalidates thousands of tokens therefore makes
-- thousands of PostgREST round trips inside one request, against a 1000
-- subrequest ceiling, so the notify can fail part-way and report a partial
-- deactivation. Taking the array makes it one statement.

CREATE OR REPLACE FUNCTION public.deactivate_push_tokens(p_push_tokens TEXT[])
RETURNS INT AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE push_tokens
  SET is_active = FALSE
  WHERE push_token = ANY(p_push_tokens) AND is_active;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public';

REVOKE EXECUTE ON FUNCTION public.deactivate_push_tokens(TEXT[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_push_tokens(TEXT[]) TO service_role;

COMMENT ON FUNCTION public.deactivate_push_tokens(TEXT[]) IS
  'Deactivates every token in the array in one statement and returns how many rows changed. Service_role only.';