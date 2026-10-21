-- Flutterwave is the only billing provider implemented in the app.
--
-- The old dual-provider defaults left app_config pointing at RevenueCat
-- (`default_provider = 'revenuecat'`, `flutterwave_enabled = false`). Nothing
-- in the client or worker implements RevenueCat, and the mobile billing screen
-- calls the Flutterwave checkout directly, so the flags contradicted the
-- actual payment path. Point the single-row config at Flutterwave.

UPDATE public.app_config
SET revenuecat_enabled = false,
    flutterwave_enabled = true,
    default_provider = 'flutterwave',
    updated_at = now()
WHERE id = 1;
