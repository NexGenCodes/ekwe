-- Add per-currency local pricing to subscription_config.
--
-- The worker reads `local_prices` (a jsonb map of Flutterwave-billable
-- currency → { monthly, annual }) so the app's displayed price == the charged
-- amount, editable in this one row with zero app/store changes.
--
-- NGN is the anchor: ₦3,000/mo. Every other currency is its equivalent priced
-- at real mid-2026 cross-rates, rounded UP so each converts back to just above
-- ₦3,000. Annual prices bake in the ~20% annual discount (monthly × 12 × 0.8),
-- rounded to the currency's minor units.
--
-- RLS is table-level, so the existing REVOKE/RLS setup from
-- 20260815000000_create_subscription_config.sql already covers this column
-- (only the service role, which bypasses RLS, can read or write it).

ALTER TABLE public.subscription_config
  ADD COLUMN IF NOT EXISTS local_prices jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Seed/backfill the single row (also keeps a fresh database consistent).
INSERT INTO public.subscription_config (
  id,
  base_price_usd,
  discount_percent,
  annual_discount_percent,
  local_prices
)
VALUES (
  1,
  2.23,
  0,
  20,
  '{
    "USD": { "monthly": 2.23,  "annual": 21.41 },
    "NGN": { "monthly": 3000,  "annual": 28800 },
    "GHS": { "monthly": 25,    "annual": 240 },
    "KES": { "monthly": 288,   "annual": 2765 },
    "ZAR": { "monthly": 36,    "annual": 346 },
    "ZMW": { "monthly": 41,    "annual": 394 },
    "UGX": { "monthly": 8200,  "annual": 78720 },
    "TZS": { "monthly": 5900,  "annual": 56640 },
    "RWF": { "monthly": 3260,  "annual": 31296 },
    "XOF": { "monthly": 1270,  "annual": 12192 },
    "XAF": { "monthly": 1270,  "annual": 12192 },
    "GBP": { "monthly": 1.65,  "annual": 15.84 },
    "EUR": { "monthly": 1.93,  "annual": 18.53 },
    "CAD": { "monthly": 3.09,  "annual": 29.66 }
  }'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  base_price_usd = EXCLUDED.base_price_usd,
  discount_percent = EXCLUDED.discount_percent,
  annual_discount_percent = EXCLUDED.annual_discount_percent,
  local_prices = EXCLUDED.local_prices;