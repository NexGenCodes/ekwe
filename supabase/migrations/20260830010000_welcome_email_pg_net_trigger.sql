-- Secure, non-blocking welcome-email trigger for new users.
--
-- HISTORY
--   * 20260609000000: on_auth_user_created_send_welcome_email trigger -> broken,
--     aborted every auth.users INSERT ("Database error saving new user").
--   * 20260814010000: removed that trigger.
--   * (manual, on hosted DB) on_auth_user_created / notify_new_user() -> BROKEN:
--     a blocking AFTER INSERT trigger calling supabase_functions.http_request with
--     a hardcoded service-role key. When the HTTP call fails it aborts every insert,
--     taking down ALL sign-ups. Removed by 20260830000000.
--
-- THIS MIGRATION replaces those with a RELIABLE, NON-BLOCKING mechanism:
--   * pg_net.http_post() is asynchronous / fire-and-forget, so it can NEVER block
--     the auth.users write (unlike supabase_functions.http_request).
--   * The webhook auth secret is stored encrypted in Supabase Vault (pgsodium),
--     NOT hardcoded in the function source -> no leaked credentials.
--   * The request targets the already-deployed send-welcome-email edge function,
--     which authenticates via SEND_WELCOME_EMAIL_SECRET.
--
-- IMPORTANT — SEND ONLY TO NEW USERS (first email confirmation):
--   This app uses a single combined login/signup path (create_user: true on OTP).
--   Every OTP request for an unknown email auto-creates an auth.users row with
--   email_confirmed_at = NULL — including typo'd / returning "login" attempts.
--   Sending on plain INSERT would spam a welcome email to anyone who merely
--   types an email. So the trigger only acts on the FIRST confirmation:
--     * trigger: AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
--     * gate:    NEW.email_confirmed_at IS NOT NULL
--                AND (TG_OP = 'INSERT' OR OLD.email_confirmed_at IS NULL)
--   Resulting behaviour:
--     * Email OTP insert (unconfirmed)                          -> NO email
--     * Email OTP verify (OLD NULL -> NEW set, first confirm)   -> email  (new)
--     * Social signup (inserted already confirmed)              -> email  (new)
--     * Returning user / re-confirmation (already confirmed)    -> NO email
--   i.e. the welcome email goes out exactly once, only when a user's email is
--   first confirmed — it never re-welcomes returning users.
--
-- The secret is created idempotently if it is not already present.
DO $$
DECLARE
  v_secret_id uuid;
BEGIN
  -- Only seed if the named secret is not already in Vault.
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'send_welcome_email_secret'
  ) THEN
    v_secret_id := vault.create_secret(
      'ekwe-welcome-email-webhook-secret',
      'send_welcome_email_secret',
      'Webhook auth secret for the send-welcome-email edge function'
    );
  END IF;
END $$;

-- Trigger function: read the vault secret and fire the async HTTP request.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_secret text;
  v_payload jsonb;
BEGIN
  -- Only welcome NEW users: send on the first email confirmation only.
  -- (At INSERT an OTP user is unconfirmed -> skip; a social user is already
  --  confirmed at INSERT -> send. On UPDATE, only the OLD NULL -> NEW set
  --  transition sends -> a returning/re-confirming user never gets it again.)
  IF NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.email_confirmed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Pull the webhook secret from encrypted Vault storage (never hardcoded).
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'send_welcome_email_secret'
  LIMIT 1;

  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE WARNING 'send_welcome_email_secret not found in vault; skipping welcome email for %', NEW.id;
    RETURN NEW;
  END IF;

  v_payload := jsonb_build_object(
    'type', 'INSERT',
    'table', 'users',
    'schema', 'auth',
    'record', to_jsonb(NEW),
    'old_record', null
  );

  -- Async / non-blocking HTTP request via pg_net. Returns immediately; a failure
  -- here can never abort the auth.users INSERT.
  PERFORM net.http_post(
    url    := 'https://zsjcgebczzbmaarfcdny.supabase.co/functions/v1/send-welcome-email',
    body   := v_payload,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    timeout_milliseconds := 10000
  );

  RETURN NEW;
END;
$function$;

-- Attach the non-blocking trigger. Idempotent.
DROP TRIGGER IF EXISTS on_auth_user_created_handle_new_user ON auth.users;
CREATE TRIGGER on_auth_user_created_handle_new_user
  AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
