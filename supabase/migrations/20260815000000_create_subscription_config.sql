-- Migration to create the subscription_config table.
-- A single-row table (id = 1) that the Cloudflare Worker reads to build the
-- /pricing response. Editing this row updates the discounted local price the
-- app shows with zero app/store changes (display-only discount; the store
-- always charges the product's list price).
--
--   base_price_usd        : the USD list price of the monthly Pro product.
--   discount_percent      : global % off the monthly price shown to every
--                           eligible user (0..100). This is the hook a future
--                           promo-code lookup folds into: the worker resolves
--                           a code into this same field, so the response
--                           already carries discountPercent + originalPriceUsd
--                           and the UI needs no changes to show a promo.
--   annual_discount_percent: additional % off the annual plan, applied on top
--                           of the monthly price × 12 (e.g. $2/mo → $24/yr →
--                           20% off → $19.20/yr). 0..100.

CREATE TABLE IF NOT EXISTS public.subscription_config (
  id integer PRIMARY KEY CHECK (id = 1),
  base_price_usd numeric(10, 2) NOT NULL DEFAULT 2.00,
  discount_percent numeric(5, 2) NOT NULL DEFAULT 0,
  annual_discount_percent numeric(5, 2) NOT NULL DEFAULT 20,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed the single row so the worker always has a value to read.
INSERT INTO public.subscription_config (
  id,
  base_price_usd,
  discount_percent,
  annual_discount_percent
)
VALUES (1, 2.00, 0, 20)
ON CONFLICT (id) DO NOTHING;

-- The worker reads this table with the service role key; no client role ever
-- needs SELECT, and nothing below the service role should write to it.
REVOKE ALL ON public.subscription_config FROM anon, authenticated;

-- Row-level security: locked down by default. Only the service role (which
-- bypasses RLS) can read or update it, so an attacker with a user JWT can
-- neither read pricing internals nor change the discount.
ALTER TABLE public.subscription_config ENABLE ROW LEVEL SECURITY;