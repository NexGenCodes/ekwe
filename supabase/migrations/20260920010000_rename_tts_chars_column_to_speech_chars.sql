-- Rename user_daily_usage.tts_chars → speech_chars.
--
-- The quota RPCs were realigned to the worker's "speech" contract in
-- 20260920000000_rename_tts_to_speech.sql, but the storage column kept its
-- TTS-era name. The column is only ever read/written through the
-- service_role RPCs (check_preflight / consume_usage / get_daily_usage), so
-- this rename is safe and purely cosmetic — it finishes the product rename
-- from "tts" to "speech" end to end.
--
-- Order matters: the column is renamed FIRST, then the three functions are
-- re-created so their plpgsql bodies reference `speech_chars`.

ALTER TABLE public.user_daily_usage
  RENAME COLUMN tts_chars TO speech_chars;

COMMENT ON COLUMN public.user_daily_usage.speech_chars IS
  'Generated speech (TTS) characters today (UTC day key). Hard cap for PREMIUM; 0 for FREE (no worker TTS).';

-- ─── check_preflight: read the renamed speech char counter ─────────────
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
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_subscriptions us
    WHERE us.user_id = p_user_id
      AND us.status = 'active'
      AND (us.expires_at IS NULL OR us.expires_at > now())
  ) INTO v_is_pro;

  v_daily_limit := CASE
    WHEN v_is_pro
      THEN CASE WHEN p_type = 'speech' THEN p_premium_speech_chars_limit ELSE p_premium_daily_limit END
      ELSE p_free_daily_limit
    END;
  v_throttle_threshold := CASE
    WHEN v_is_pro AND p_type <> 'speech' THEN p_premium_throttle_threshold
    ELSE 0
    END;

  INSERT INTO public.user_usage (user_id, month, last_request_at, created_at, updated_at)
  VALUES (p_user_id, to_char(now(), 'YYYY-MM'), timezone('utc'::text, now() - interval '1 day'), now(), now())
  ON CONFLICT (user_id, month) DO NOTHING;

  SELECT last_request_at
  INTO v_last_request_at
  FROM public.user_usage
  WHERE user_id = p_user_id AND month = to_char(now(), 'YYYY-MM')
  FOR UPDATE;

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
    SELECT speech_chars INTO v_used
    FROM public.user_daily_usage
    WHERE user_id = p_user_id AND day = v_day;
  END IF;

  v_throttled := v_throttle_threshold > 0
    AND v_used IS NOT NULL
    AND v_used >= v_throttle_threshold;
  v_cooldown := CASE
    WHEN v_throttled THEN p_throttle_cooldown_seconds
    ELSE CASE WHEN v_is_pro THEN p_premium_cooldown_seconds ELSE p_free_cooldown_seconds END
  END;

  v_time_since_last_req := now() - v_last_request_at;
  IF EXTRACT(EPOCH FROM v_time_since_last_req) < v_cooldown THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'RATE_LIMIT',
      'cooldown_remaining', v_cooldown - EXTRACT(EPOCH FROM v_time_since_last_req)
    );
  END IF;

  UPDATE public.user_usage
  SET last_request_at = now()
  WHERE user_id = p_user_id AND month = to_char(now(), 'YYYY-MM');

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

-- ─── consume_usage: charge the renamed speech char counter ─────────────
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

  INSERT INTO public.user_daily_usage (user_id, day, translate_count, transcribe_count, speech_chars, updated_at)
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
    speech_chars = CASE WHEN p_type = 'speech' THEN public.user_daily_usage.speech_chars + p_chars ELSE public.user_daily_usage.speech_chars END,
    updated_at = now()
  RETURNING CASE
    WHEN p_type = 'translate' THEN translate_count
    WHEN p_type = 'transcribe' THEN transcribe_count
    ELSE speech_chars
  END INTO v_count;

  RETURN jsonb_build_object('count', v_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_usage(uuid, text, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_usage(uuid, text, int) TO service_role;

COMMENT ON FUNCTION public.consume_usage(uuid, text, int) IS
  'Atomically increments today''s counter for the given request type (translate/transcribe +1, speech +p_chars characters). Service_role only.';

-- ─── get_daily_usage: read the renamed speech char counter ─────────────
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
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT translate_count, transcribe_count, speech_chars
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