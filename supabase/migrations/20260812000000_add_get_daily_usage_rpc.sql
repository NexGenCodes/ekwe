-- Read-only daily usage snapshot for the /usage endpoint.
--
-- Unlike check_preflight, this RPC does NOT serialize on the row lock,
-- extend cooldowns, or consume anything — it's a pure SELECT for the user's
-- current UTC-day counters so the mobile app can show "X of Y used today".
--
-- The numeric limits are NOT returned here: they live in
-- packages/shared/plans.ts and the Worker injects them (single SSOT).

CREATE OR REPLACE FUNCTION public.get_daily_usage(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_day text := to_char(timezone('utc', now()), 'YYYY-MM-DD');
  v_translate int;
  v_transcribe int;
BEGIN
  -- Only service_role (the Worker) may read another user's counters; the same
  -- guard blocks authenticated callers from probing other users.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT translate_count, transcribe_count
    INTO v_translate, v_transcribe
    FROM public.user_daily_usage
   WHERE user_id = p_user_id AND day = v_day;

  RETURN jsonb_build_object(
    'day', v_day,
    'translate', COALESCE(v_translate, 0),
    'transcribe', COALESCE(v_transcribe, 0)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_daily_usage(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_usage(uuid) TO service_role;

COMMENT ON FUNCTION public.get_daily_usage(uuid) IS
  'Read-only today counters (translate/transcribe) for /usage. Service_role only. Limits come from the Worker (plans.ts), not SQL.';