-- Stop sending the whole auth.users row to the welcome-email edge function.
--
-- `handle_new_user()` built its pg_net payload with `to_jsonb(NEW)`, which is
-- the ENTIRE auth.users row. That row carries `encrypted_password`,
-- `confirmation_token`, `recovery_token`, `email_change_token_new` and
-- `email_change_token_current`, so every signup copied the user's password
-- hash and email-confirmation tokens out of the database and over the wire to
-- an edge function that only ever reads `record.email`.
--
-- Nothing needed them. The edge function's WebhookPayload types `record` as
-- `{ id: string; email?: string }`, so sending those two fields is the whole
-- contract. This narrows the payload to match, which is the difference between
-- shipping secrets and shipping an address.
--
-- Forward-only: 20260830010000 is already applied and locked in checksums.json,
-- so it is corrected here rather than edited.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

  -- Built explicitly rather than with to_jsonb(NEW): an explicit column list
  -- cannot start shipping auth.users columns nobody asked for.
  v_payload := jsonb_build_object(
    'type', 'INSERT',
    'table', 'users',
    'schema', 'auth',
    'record', jsonb_build_object(
      'id', NEW.id,
      'email', NEW.email
    ),
    'old_record', NULL
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
