-- Revoke EXECUTE on check_session_active from the client roles (anon,
-- authenticated). The worker alone calls this RPC (service_role) as part of
-- preflight (apps/worker/src/services/preflight.ts). It is SECURITY DEFINER
-- and answers "does this session ID exist?" — leaving it callable by anon/
-- authenticated turns it into a session-ID enumeration/probing oracle.
-- Direct exec via Postgres (postgres owner, service_role) is preserved.

REVOKE EXECUTE ON FUNCTION check_session_active(UUID)
  FROM anon, authenticated;