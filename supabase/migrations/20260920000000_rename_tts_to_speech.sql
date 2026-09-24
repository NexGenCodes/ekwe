-- Rename the check_preflight/consume_usage/get_daily_usage TTS contract to
-- "speech" to match the worker + shared product naming.
--
-- The Worker (apps/worker/src/services/preflight.ts, routes/synthesize.ts)
-- dropped the old /tts route in favor of /synthesize and now talks to the quota
-- RPCs in "speech" terms:
--
--   * check_preflight is called with p_premium_speech_chars_limit and
--     p_type = 'speech' (UsageType in packages/shared).
--   * consume_usage is called with p_type = 'speech' and charges p_chars.
--   * get_daily_usage is read by apps/worker/src/services/usage.ts, which
--     expects a `speech` key (falls back to 0 when absent).
--
-- The deployed DB still used the TTS-era names, so every preflight RPC 404'd
-- (PGRST202, "p_premium_speech_chars_limit ... no matches found in the schema
-- cache") and the worker failed closed — all transcribe/translate/synthesize
-- requests were denied. This migration aligns the DB with the worker.
--
-- The underlying column stays `user_daily_usage.tts_chars` (read/written only
-- through these service_role RPCs), so no column migration is needed.

-- ─── check_preflight: rename arg + switch the char-quota branch to 'speech' ─
DROP FUNCTION IF EXISTS public.check_preflight(uuid, text, int, int, int, int, int, int, int, int);

CREATE OR REPLACE FUNCTION public.check_preflight(
  p_user_id UUID,
  p_type TEXT DEFAULT 'translate',
  p_free_cooldown_seconds INT DEFAULT 3,
  p_free_daily_limit INT DEFAULT 25,
  p_premium_cooldown_seconds INT DEFAULT 1,
  p_premium_daily_limit INT DEFAULT 0,
  p_premium_throttle_threshold INT DEFAULT 500,
  p_throttle_cooldown_seconds INT DEFAULT 3,
  p_premium_speech_chars_limit INT DEFAULT 0,
  p_charge_chars INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_last_request_at TIMESTAMP WITH TIME ZONE;
  v_time_since_last_req INTERVAL;
  v_day TEXT;
  v_used INT;
  v_throttled BOOLEAN;
  v_cooldown INT;
  v_daily_limit INT;
  v_throttle_threshold INT;
  v_is_pro BOOLEAN;
BEGIN
  -- Only service_role (the Worker) may act on behalf of another user; the
  -- same guard blocks authenticated callers from poisoning cooldowns/quotas.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Authoritative tier: same predicate as the custom access token hook
  -- (20260804000001_harden_access_token_hook_expiry.sql). NULL expires_at =
  -- lifetime (Paystack/Flutterwave charge).
  SELECT EXISTS (
    SELECT 1
    FROM public.user_subscriptions us
    WHERE us.user_id = p_user_id
      AND us.status = 'active'
      AND (us.expires_at IS NULL OR us.expires_at > now())
  ) INTO v_is_pro;

  -- Effective limits come from the DB-backed tier, not the (possibly stale)
  -- JWT tier. The speech pool is forced on FREE (no worker TTS) and has NO
  -- abuse throttle threshold (it is already a hard char cap).
  v_daily_limit := CASE
    WHEN v_is_pro
      THEN CASE WHEN p_type = 'speech' THEN p_premium_speech_chars_limit ELSE p_premium_daily_limit END
      ELSE p_free_daily_limit
    END;
  v_throttle_threshold := CASE
    WHEN v_is_pro AND p_type <> 'speech' THEN p_premium_throttle_threshold
    ELSE 0
    END;

  -- Upsert the user usage row for this month (kept for cooldown tracking)
  INSERT INTO public.user_usage (user_id, month, last_request_at, created_at, updated_at)
  VALUES (p_user_id, to_char(now(), 'YYYY-MM'), timezone('utc'::text, now() - interval '1 day'), now(), now())
  ON CONFLICT (user_id, month) DO NOTHING;

  -- Lock the row for update to serialize concurrent requests
  SELECT last_request_at
  INTO v_last_request_at
  FROM public.user_usage
  WHERE user_id = p_user_id AND month = to_char(now(), 'YYYY-MM')
  FOR UPDATE;

  -- Read the day count up-front so the throttled cooldown can be chosen below.
  -- v_daily_limit <= 0 means "no quota" (safety valve) and v_throttle_threshold
  -- <= 0 means "no throttle".
  v_day := to_char(timezone('utc', now()), 'YYYY-MM-DD');
  v_used := NULL;
  IF (v_daily_limit > 0 OR v_throttle_threshold > 0) AND p_type = 'translate' THEN
    SELECT translate_count INTO v_used
    FROM public.user_daily_usage
    WHERE user_id = p_user_id AND day = v_day;
  ELSIF (v_daily_limit > 0 OR v_throttle_threshold > 0) AND p_type = 'transcribe' THEN
    SELECT transcribe_count INTO v_used
    FROM public.user_daily_usage
    WHERE user_id = p_user_id AND day = v_day;
  ELSIF (v_daily_limit > 0 OR v_throttle_threshold > 0) AND p_type = 'speech' THEN
    SELECT tts_chars INTO v_used
    FROM public.user_daily_usage
    WHERE user_id = p_user_id AND day = v_day;
  END IF;

  -- Throttled users are slowed (free-tier cooldown), never denied.
  v_throttled := v_throttle_threshold > 0
    AND v_used IS NOT NULL
    AND v_used >= v_throttle_threshold;
  v_cooldown := CASE
    WHEN v_throttled THEN p_throttle_cooldown_seconds
    ELSE CASE WHEN v_is_pro THEN p_premium_cooldown_seconds ELSE p_free_cooldown_seconds END
  END;

  -- Check Cooldown (effective cooldown accounts for throttling)
  v_time_since_last_req := now() - v_last_request_at;
  IF EXTRACT(EPOCH FROM v_time_since_last_req) < v_cooldown THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'RATE_LIMIT',
      'cooldown_remaining', v_cooldown - EXTRACT(EPOCH FROM v_time_since_last_req)
    );
  END IF;

  -- Update last_request_at immediately to lock out other rapid requests
  UPDATE public.user_usage
  SET last_request_at = now()
  WHERE user_id = p_user_id AND month = to_char(now(), 'YYYY-MM');

  -- Hard daily quota. translate/transcribe count REQUEST at the cap; speech
  -- charges CHARACTERS and may land exactly on the cap (`used + charge > cap`)
  -- without ever overshooting it.
  IF v_used IS NOT NULL AND v_daily_limit > 0
     AND p_type = 'speech'
     AND v_used + p_charge_chars > v_daily_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'QUOTA_EXCEEDED',
      'quota_total', v_daily_limit,
      'quota_remaining', GREATEST(v_daily_limit - COALESCE(v_used, 0), 0)
    );
  ELSIF v_used IS NOT NULL AND v_daily_limit > 0
     AND p_type <> 'speech'
     AND v_used >= v_daily_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'QUOTA_EXCEEDED',
      'quota_total', v_daily_limit,
      'quota_remaining', 0
    );
  END IF;

  -- Allowed
  RETURN jsonb_build_object(
    'allowed', true,
    'tier_active', CASE WHEN v_is_pro THEN 'PREMIUM' ELSE 'FREE' END,
    'throttled', v_throttled,
    'quota_total', v_daily_limit,
    'quota_remaining', GREATEST(v_daily_limit - COALESCE(v_used, 0), 0)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_preflight(UUID, TEXT, INT, INT, INT, INT, INT, INT, INT, INT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_preflight(UUID, TEXT, INT, INT, INT, INT, INT, INT, INT, INT) TO service_role;

COMMENT ON FUNCTION public.check_preflight(UUID, TEXT, INT, INT, INT, INT, INT, INT, INT, INT) IS
  'Cooldown + daily quota gate with the authoritative tier derived from user_subscriptions (same predicate as the access token hook). translate/transcribe count requests; speech charges p_charge_chars characters against p_premium_speech_chars_limit and may land exactly on the cap. The Worker passes both FREE and PREMIUM limits; the RPC applies the effective tier''s. Service_role only.';

-- ─── consume_usage: charge-aware char counter for speech ───────────────
-- translate/transcribe keep their atomic +1; speech adds p_chars to tts_chars.
CREATE OR REPLACE FUNCTION public.consume_usage(p_user_id uuid, p_type text, p_chars int default 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_day TEXT := to_char(timezone('utc', now()), 'YYYY-MM-DD');
  v_count INT;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.user_daily_usage (user_id, day, translate_count, transcribe_count, tts_chars, updated_at)
  VALUES (
    p_user_id, v_day,
    CASE WHEN p_type = 'translate' THEN 1 ELSE 0 END,
    CASE WHEN p_type = 'transcribe' THEN 1 ELSE 0 END,
    CASE WHEN p_type = 'speech' THEN p_chars ELSE 0 END,
    now()
  )
  ON CONFLICT (user_id, day) DO UPDATE
  SET
    translate_count = CASE WHEN p_type = 'translate' THEN public.user_daily_usage.translate_count + 1 ELSE public.user_daily_usage.translate_count END,
    transcribe_count = CASE WHEN p_type = 'transcribe' THEN public.user_daily_usage.transcribe_count + 1 ELSE public.user_daily_usage.transcribe_count END,
    tts_chars = CASE WHEN p_type = 'speech' THEN public.user_daily_usage.tts_chars + p_chars ELSE public.user_daily_usage.tts_chars END,
    updated_at = now()
  RETURNING CASE
    WHEN p_type = 'translate' THEN translate_count
    WHEN p_type = 'transcribe' THEN transcribe_count
    ELSE tts_chars
  END INTO v_count;

  RETURN jsonb_build_object('count', v_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_usage(uuid, text, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_usage(uuid, text, int) TO service_role;

COMMENT ON FUNCTION public.consume_usage(uuid, text, int) IS
  'Atomically increments today''s counter for the given request type (translate/transcribe +1, speech +p_chars characters). Service_role only.';

-- ─── get_daily_usage: expose the speech char counter to /usage ─────────
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
  v_speech int;
BEGIN
  -- Only service_role (the Worker) may read another user's counters; the same
  -- guard blocks authenticated callers from probing other users.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT translate_count, transcribe_count, tts_chars
    INTO v_translate, v_transcribe, v_speech
    FROM public.user_daily_usage
   WHERE user_id = p_user_id AND day = v_day;

  RETURN jsonb_build_object(
    'day', v_day,
    'translate', COALESCE(v_translate, 0),
    'transcribe', COALESCE(v_transcribe, 0),
    'speech', COALESCE(v_speech, 0)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_daily_usage(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_usage(uuid) TO service_role;

COMMENT ON FUNCTION public.get_daily_usage(uuid) IS
  'Read-only today counters (translate/transcribe/speech chars) for /usage. Service_role only. Limits come from the Worker (plans.ts), not SQL.';