-- Seed data for local development

-- ─── Test Users ─────────────────────────────────────────────────────
-- Pro user:  pro@test.com / password123
-- Free user: free@test.com / password123

-- Suppress triggers during seed (bypass welcome email trigger dependency on pg_net)
SET session_replication_role = replica;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmation_token, recovery_token, email_change, email_change_token_new, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, deleted_at)
VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'pro@test.com',    crypt('password123', gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now(), false, null),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'free@test.com',   crypt('password123', gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now(), false, null)
ON CONFLICT (id) DO NOTHING;

SET session_replication_role = origin;

-- ─── Subscription Config ─────────────────────────────────────────────
-- Single-row pricing config the worker /pricing endpoint reads. Discount is
-- display-only: the store still charges the product list price. Annual price
-- is monthly × 12 with annual_discount_percent applied on top.
INSERT INTO public.subscription_config (
  id,
  base_price_usd,
  discount_percent,
  annual_discount_percent
)
VALUES (1, 2.00, 0, 20)
ON CONFLICT (id) DO NOTHING;

-- ─── Identities (required for email+password sign-in) ───────────────

INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', format('{"sub":"%s","email":"pro@test.com"}', '00000000-0000-0000-0000-000000000001')::jsonb, 'email', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', format('{"sub":"%s","email":"free@test.com"}', '00000000-0000-0000-0000-000000000002')::jsonb, 'email', now(), now(), now())
ON CONFLICT (provider_id, provider) DO NOTHING;

-- ─── Subscriptions ──────────────────────────────────────────────────
-- Pro user: active monthly subscription (expires 30 days from now)
-- Free user: inactive (no active subscription)

INSERT INTO public.user_subscriptions (user_id, status, product_id, platform, expires_at)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'active',   'ekwe_pro_monthly', 'ios', now() + interval '30 days'),
  ('00000000-0000-0000-0000-000000000002', 'inactive', null,               null,  null)
ON CONFLICT (user_id) DO
  UPDATE SET
    status     = EXCLUDED.status,
    product_id = EXCLUDED.product_id,
    platform   = EXCLUDED.platform,
    expires_at = EXCLUDED.expires_at;

-- ─── Usage Records (current month) ──────────────────────────────────

INSERT INTO public.user_usage (user_id, month, usage_count, transactions_used)
VALUES
  ('00000000-0000-0000-0000-000000000001', to_char(now(), 'YYYY-MM'), 5,  2),
  ('00000000-0000-0000-0000-000000000002', to_char(now(), 'YYYY-MM'), 15, 0)
ON CONFLICT (user_id, month) DO
  UPDATE SET
    usage_count       = EXCLUDED.usage_count,
    transactions_used = EXCLUDED.transactions_used;
