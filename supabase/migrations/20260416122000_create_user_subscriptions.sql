-- user_subscriptions: Tracks active RevenueCat subscription status per user.
-- The custom_access_token_hook reads this table to inject `is_pro` into JWTs.
-- RevenueCat webhook (or a Supabase Edge Function) writes to this table
-- whenever a subscription is created, renewed, or cancelled.

CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'expired', 'cancelled')),
  product_id      TEXT,
  platform        TEXT CHECK (platform IN ('ios', 'android', 'web')),
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can read their own subscription status
CREATE POLICY "Users can read own subscription"
  ON public.user_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- Only service_role (webhooks/edge functions) can insert/update subscriptions
-- No user-facing INSERT/UPDATE policies — this prevents client-side spoofing.

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON public.user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON public.user_subscriptions(status);

-- Grant the supabase_auth_admin role access so the JWT hook can query this table
GRANT SELECT ON public.user_subscriptions TO supabase_auth_admin;
