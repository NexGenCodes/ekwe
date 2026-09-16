-- ─── Fix payment_config SELECT Policy ──────────────────────────────
-- Restricts the public read access of payment_config to just the
-- service_role, patching the previous `USING (TRUE)` which allowed
-- anyone to read it.
--
-- Migration: 20260912000000_fix_payment_config_policy.sql

DROP POLICY IF EXISTS "Service role can read payment_config" ON payment_config;

CREATE POLICY "Service role can read payment_config"
  ON payment_config
  FOR SELECT
  TO service_role
  USING (TRUE);
