-- delete_user: Securely deletes the calling user and all cascaded data.
-- All related tables (history, user_subscriptions, user_usage, etc.)
-- use ON DELETE CASCADE from auth.users(id), so one DELETE suffices.
--
-- Usage:  SELECT public.delete_user();
--         (must be called by an authenticated user)

CREATE OR REPLACE FUNCTION public.delete_user()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;

-- Grant execute to authenticated users only
REVOKE EXECUTE ON FUNCTION public.delete_user() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.delete_user() TO authenticated;
