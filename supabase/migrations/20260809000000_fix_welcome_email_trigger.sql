-- Fix welcome-email trigger: the original used extensions.http_post (pg_http),
-- which doesn't exist unless the `http` extension is enabled. pg_net exposes
-- net.http_post. A missing function in an AFTER INSERT trigger on auth.users
-- aborts every new-user insert → GoTrue returns "Database error saving new user".
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.send_welcome_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://zsjcgebczzbmaarfcdny.supabase.co/functions/v1/send-welcome-email',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'users',
      'schema', 'auth',
      'record', jsonb_build_object('id', NEW.id, 'email', NEW.email)
    )
  );
  RETURN NEW;
END;
$$;
