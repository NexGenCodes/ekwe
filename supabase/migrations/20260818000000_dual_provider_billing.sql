-- ─── Dual Provider Billing ────────────────────────────────────────
-- Adds provider tracking to user_subscriptions so both RevenueCat and
-- Flutterwave can write to the same table. Also creates payment_config
-- for feature flag toggles, and bumps set_pro_status to v4 with a
-- provider parameter.
--
-- Migration: 20260818000000_dual_provider_billing.sql

-- 1. Add provider tracking columns to user_subscriptions
-- ─────────────────────────────────────────────────────
-- provider: which payment system created/updated this row ("revenuecat" | "flutterwave")
-- payment_reference: provider-specific reference (RC original_transaction_id or Flutterwave tx_ref)
-- flutterwave_tx_ref: Flutterwave transaction reference for quick lookups
ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'revenuecat',
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS flutterwave_tx_ref TEXT;

-- Index for provider-based queries (e.g. "show me all Flutterwave subscribers")
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_provider
  ON user_subscriptions (provider)
  WHERE provider IS NOT NULL;

-- Index for Flutterwave tx_ref lookups (webhook dedup, admin queries)
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_flutterwave_tx_ref
  ON user_subscriptions (flutterwave_tx_ref)
  WHERE flutterwave_tx_ref IS NOT NULL;

-- 2. Feature flags table for payment providers
-- ─────────────────────────────────────────────
-- Singleton row (id = 1) storing provider toggle states. The mobile app
-- fetches this on boot to determine which payment methods to show.
CREATE TABLE IF NOT EXISTS payment_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  revenuecat_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  flutterwave_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  default_provider TEXT NOT NULL DEFAULT 'revenuecat'
    CHECK (default_provider IN ('revenuecat', 'flutterwave')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default config if not exists
INSERT INTO payment_config (id, revenuecat_enabled, flutterwave_enabled, default_provider)
VALUES (1, TRUE, FALSE, 'revenuecat')
ON CONFLICT (id) DO NOTHING;

-- Allow service-role read access (used by the mobile app's billing screen)
ALTER TABLE payment_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can read payment_config"
  ON payment_config
  FOR SELECT
  USING (TRUE);

-- 3. Bump set_pro_status to v4 with provider parameter
-- ────────────────────────────────────────────────────
-- The provider parameter lets the caller identify which payment system
-- triggered the status change. This is stored on the subscription row
-- for auditability and admin queries.
--
-- The v4 upgrade is backward-compatible: existing callers that don't pass
-- p_provider will get the default value of 'revenuecat'.

CREATE OR REPLACE FUNCTION set_pro_status(
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

  -- Upsert subscription: insert or update
  INSERT INTO user_subscriptions (user_id, is_pro, expires_at, provider, updated_at)
  VALUES (v_user_id, p_is_pro, p_expires_at, v_provider, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    is_pro = EXCLUDED.is_pro,
    -- Guard: only overwrite expires_at if the new value is non-null, OR if we're
    -- explicitly revoking (p_is_pro = false). This prevents a cancellation event
    -- from clobbering a future expiry set by a prior renewal event.
    expires_at = CASE
      WHEN EXCLUDED.expires_at IS NOT NULL THEN EXCLUDED.expires_at
      WHEN NOT EXCLUDED.is_pro THEN EXCLUDED.expires_at  -- revoke: allow null
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service role (webhook uses service-role key)
GRANT EXECUTE ON FUNCTION set_pro_status TO service_role;

-- 4. Backfill provider column for existing rows
-- ─────────────────────────────────────────────
-- Existing rows were created by RevenueCat webhooks, so default them to
-- 'revenuecat'. This is idempotent (only affects rows still at the default).
UPDATE user_subscriptions
SET provider = 'revenuecat'
WHERE provider IS NULL OR provider = 'revenuecat';
