-- Close the "deleted user" auth window on billable routes.
--
-- A Supabase access token (JWT) is stateless: after an admin deletes a user,
-- an already-issued token stays cryptographically valid until `exp` (up to an
-- hour), so the Worker's local JWKS signature verification alone cannot tell
-- that the user is gone — they could keep burning billable quota. Supabase's
-- documented fix for sensitive operations is to validate the JWT's
-- `session_id` claim against auth.sessions: deleting a user removes their
-- session rows, so this check fails immediately. Deleting a user also
-- cascades to auth.sessions and revokes their refresh tokens, so they cannot
-- mint a replacement token either.
--
-- The Worker already makes a database round-trip (check_preflight) on every
-- billable request, so this boolean slots into that path (apps/worker/src/
-- utils/preflight.ts). It fails open when the RPC errors (the local signature
-- check still ran) and fails closed only on a definitive "no such session".
--
-- SECURITY DEFINER with a fixed search_path (the sessions table lives in the
-- auth schema), parameter-only, returns a single boolean — nothing sensitive
-- crosses the wire. EXECUTE is revoked from PUBLIC and re-granted only to
-- service_role (the Worker calls it with the service key).
CREATE OR REPLACE FUNCTION public.check_session_active(p_session_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'auth', 'pg_catalog'
AS $$
  SELECT EXISTS (SELECT 1 FROM auth.sessions WHERE id = p_session_id);
$$;

REVOKE ALL ON FUNCTION public.check_session_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_session_active(uuid) TO service_role;