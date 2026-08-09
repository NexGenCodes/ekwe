-- Use pg_net (available on all hosted Supabase projects) to call the Edge Function
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

-- Fire when a new user row is created in auth.users
CREATE TRIGGER on_auth_user_created_send_welcome_email
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.send_welcome_email();
