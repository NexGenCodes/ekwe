-- Remove the broken welcome-email trigger + function.
--
-- Why the trigger path can never work:
--   1. public.send_welcome_email() calls the Edge Function with only a
--      Content-Type header. send-welcome-email/index.ts isAuthorized()
--      rejects every request that lacks a Bearer token (401), so no welcome
--      email has ever been sent through this path.
--   2. Fixing it by embedding the service-role key (or a webhook secret) in a
--      SECURITY DEFINER function would store a privileged secret in the
--      database and run network calls under the definer's privileges — a worse
--      trade than the bug.
--
-- Correct mechanism (already implemented in the Edge Function): a Supabase
-- Dashboard Database Webhook. Configure it as:
--   - Table: auth.users, Event: INSERT
--   - URL: https://<project-ref>.supabase.co/functions/v1/send-welcome-email
--   - Method: POST
--   - Header: Authorization: Bearer <SEND_WELCOME_EMAIL_SECRET>
--     (set SEND_WELCOME_EMAIL_SECRET as a function secret to match)
--   - verify_jwt: disabled (the function authenticates via the bearer header)
-- The function's payload shape (type/table/schema/record) already matches what
-- the Database Webhook delivers.
DROP TRIGGER IF EXISTS on_auth_user_created_send_welcome_email ON auth.users;

DROP FUNCTION IF EXISTS public.send_welcome_email();
