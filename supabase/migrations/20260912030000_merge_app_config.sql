-- Merge subscription_config and payment_config into a single app_config table

CREATE TABLE IF NOT EXISTS public.app_config (
  id integer PRIMARY KEY CHECK (id = 1),
  revenuecat_enabled boolean NOT NULL DEFAULT true,
  flutterwave_enabled boolean NOT NULL DEFAULT false,
  default_provider text NOT NULL DEFAULT 'revenuecat'
    CHECK (default_provider IN ('revenuecat', 'flutterwave')),
  base_price_usd numeric(10, 2) NOT NULL DEFAULT 2.00,
  discount_percent numeric(5, 2) NOT NULL DEFAULT 0,
  annual_discount_percent numeric(5, 2) NOT NULL DEFAULT 20,
  local_prices jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed from existing data if possible, or defaults
INSERT INTO public.app_config (
  id,
  revenuecat_enabled, flutterwave_enabled, default_provider,
  base_price_usd, discount_percent, annual_discount_percent, local_prices
)
SELECT 
  1,
  COALESCE((SELECT revenuecat_enabled FROM payment_config WHERE id = 1), true),
  COALESCE((SELECT flutterwave_enabled FROM payment_config WHERE id = 1), false),
  COALESCE((SELECT default_provider FROM payment_config WHERE id = 1), 'revenuecat'),
  COALESCE((SELECT base_price_usd FROM subscription_config WHERE id = 1), 2.23),
  COALESCE((SELECT discount_percent FROM subscription_config WHERE id = 1), 0),
  COALESCE((SELECT annual_discount_percent FROM subscription_config WHERE id = 1), 20),
  COALESCE((SELECT local_prices FROM subscription_config WHERE id = 1), '{
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
  }'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- RLS lockdown (only service_role can read/write)
REVOKE ALL ON public.app_config FROM anon, authenticated;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Drop old tables
DROP TABLE IF EXISTS public.subscription_config;
DROP TABLE IF EXISTS public.payment_config;
