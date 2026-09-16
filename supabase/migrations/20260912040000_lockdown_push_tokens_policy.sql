-- ─── Lock down push_tokens RLS to service_role only ─────────────────
-- The original migration granted FOR ALL ... USING (TRUE) to `public`,
-- meaning any anon/authenticated client could read/write every push token
-- directly through the PostgREST API even though the comment claimed
-- "service-role only". Scoping the policy to service_role means no policy
-- applies to anon/authenticated, so direct REST access is denied by default
-- while the SECURITY DEFINER RPCs (upsert_push_token, get_active_push_tokens,
-- deactivate_push_token, cleanup_old_push_tokens) keep working unchanged.
--
-- Migration: 20260912040000_lockdown_push_tokens_policy.sql

DROP POLICY IF EXISTS "Service role can manage push_tokens" ON push_tokens;

CREATE POLICY "Service role can manage push_tokens"
  ON push_tokens
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);