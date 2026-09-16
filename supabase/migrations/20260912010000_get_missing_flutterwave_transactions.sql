-- The reconciliation RPC now checks user_subscriptions.flutterwave_tx_ref
-- instead of a separate transaction_ledgers table.

DROP FUNCTION IF EXISTS public.get_missing_flutterwave_transactions(text[]);

CREATE OR REPLACE FUNCTION public.get_missing_flutterwave_transactions(p_flw_refs text[])
RETURNS TABLE(missing_ref text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT unnested.ref
  FROM unnest(p_flw_refs) AS unnested(ref)
  LEFT JOIN public.user_subscriptions us ON us.flutterwave_tx_ref = unnested.ref
  WHERE us.id IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_missing_flutterwave_transactions(text[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_missing_flutterwave_transactions(text[]) TO service_role;

COMMENT ON FUNCTION public.get_missing_flutterwave_transactions(text[]) IS
  'Takes an array of Flutterwave references and returns the ones not found in user_subscriptions.flutterwave_tx_ref. Only callable by service_role.';
