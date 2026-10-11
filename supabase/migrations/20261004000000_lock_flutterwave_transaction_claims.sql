-- Lock down flutterwave_transaction_claims.
--
-- The table was created without RLS, which left it as the one table in the
-- schema not protected. Supabase grants table privileges to anon/authenticated
-- by default, so with RLS absent a client could read every user's tx_ref,
-- amount and currency, and DELETE the replay-guard row so the same flw_ref
-- redeemed a second time.
--
-- Access is service_role only, enforced at the GRANT layer to match
-- claim_flutterwave_transaction, which already revokes EXECUTE from anon and
-- authenticated.

ALTER TABLE public.flutterwave_transaction_claims ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.flutterwave_transaction_claims FROM anon, authenticated;

COMMENT ON TABLE public.flutterwave_transaction_claims IS
  'One row per redeemed Flutterwave transaction. The primary key on flw_ref is the replay guard: a transaction can extend a subscription at most once. Written only by the service_role through claim_flutterwave_transaction; no client-facing access.';