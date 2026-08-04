-- Harden the custom access token hook: a subscription only counts as "pro"
-- while status = 'active' AND (no expires_at OR expires_at is in the future).
-- Previously the hook ignored expires_at entirely, so a stale row with
-- status='active' and a long-past expires_at kept minting is_pro JWTs.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER                       -- ← REQUIRED: run with owner privileges
SET search_path = 'public'             -- ← prevent search_path hijacking
AS $$
  DECLARE
    claims jsonb;
    v_user_id uuid;
    is_pro boolean;
  BEGIN
    -- Extract user ID safely
    v_user_id := (event->>'user_id')::uuid;

    -- Look up the user's active subscription; expires_at (when set) must be
    -- in the future. NULL expires_at = lifetime (Paystack/Flutterwave charge).
    SELECT exists (
      select 1
      from public.user_subscriptions us
      where us.user_id = v_user_id
        and us.status = 'active'
        and (us.expires_at is null or us.expires_at > now())
    ) into is_pro;

    -- Safely get claims and initialize if null
    claims := event->'claims';
    if claims is null then
      claims := '{}'::jsonb;
    end if;

    if jsonb_typeof(claims->'app_metadata') is null then
      claims := jsonb_set(claims, '{app_metadata}', '{}');
    end if;

    claims := jsonb_set(
      claims,
      '{app_metadata, is_pro}',
      to_jsonb(is_pro)
    );

    -- Return the modified event
    event := jsonb_set(event, '{claims}', claims);
    return event;
  end;
$$;

-- ── Permissions ──────────────────────────────────────────────────────────────
-- supabase_auth_admin is the role that Supabase Auth uses to call hooks.
-- It needs USAGE on the schema + EXECUTE on the function.
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

-- Lock down: prevent direct calls from client-side roles
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
