-- Create or replace the custom access token hook function
-- This allows us to embed `is_pro` directly into the Supabase JWT
-- so our Cloudflare Worker can read it securely without making 
-- DB calls on every request.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer                       -- ← REQUIRED: run with owner privileges
set search_path = 'public'             -- ← prevent search_path hijacking
as $$
  declare
    claims jsonb;
    v_user_id uuid;
    is_pro boolean;
  begin
    -- Extract user ID safely
    v_user_id := (event->>'user_id')::uuid;

    -- Look up the user's active subscription status from RevenueCat / your billing table
    select exists (
      select 1 
      from public.user_subscriptions us
      where us.user_id = v_user_id 
        and us.status = 'active'
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
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- Lock down: prevent direct calls from client-side roles
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
