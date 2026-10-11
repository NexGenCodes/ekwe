-- Retire the welcome-email webhook secret seeded in plaintext.
--
-- 20260830010000 seeded `vault.create_secret('ekwe-welcome-email-webhook-secret', ...)`
-- so a fresh database would have a known, guessable webhook secret — and that
-- literal is now in this repository's history, so it cannot be treated as
-- secret any more.
--
-- This cannot rewrite history, and history rewriting is not the fix anyway: what
-- matters is that the value in git is no longer the value in use. So rotate:
-- every Vault copy of the old literal is deleted, and the trigger skips welcome
-- emails until a real secret is provisioned.
--
-- To provision the replacement:
--
--   SELECT vault.create_secret(
--     '<a fresh random value>',
--     'send_welcome_email_secret',
--     'Webhook auth secret for the send-welcome-email edge function'
--   );
--
-- and set the same value as SEND_WELCOME_EMAIL_SECRET on the edge function.

DO $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM vault.decrypted_secrets
  WHERE name = 'send_welcome_email_secret'
    AND decrypted_secret = 'ekwe-welcome-email-webhook-secret';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted > 0 THEN
    RAISE NOTICE
      'Removed % compromised send_welcome_email_secret row(s). Welcome emails stay off until a fresh secret is provisioned.',
      v_deleted;
  END IF;
END $$;
