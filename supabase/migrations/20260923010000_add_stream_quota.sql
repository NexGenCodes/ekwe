-- Add a dedicated stream session counter (realtime WebSocket sessions).
--
-- Streaming is the last unmetered surface in the app. Unlike translate/
-- transcribe (soft, throttle-based) and speech (flat conversion hard cap),
-- stream is a HARD session cap for PREMIUM (60/day) and fully BLOCKED for FREE.
--
-- The worker guard already rejects FREE with 403 before the stream Durable
-- Object opens, so FREE never reaches the RPC. This RPC additionally hard-denies
-- p_type = 'stream' for non-pro users when the free stream limit is 0 as
-- defense in depth: a JWT that still says PREMIUM after a lapsed subscription
-- must not stream. A future plan that gives FREE some streaming flips that
-- limit to a positive number and the guard + SQL both follow.
--
-- Signature notes (kept identical to the pre-stream contract on purpose):
--   * check_preflight keeps its 10 args — the worker passes dailyStreamLimit in
--     p_free_daily_limit / p_premium_daily_limit when p_type = 'stream'.
--   * stream never throttles (no FREE lower tier to throttle to — FREE can't
--     stream at all), so the RPC also ignores any throttle threshold for it.
--   * consume_usage keeps (uuid, text, int): stream charges +1 per session.

ALTER TABLE public.user_daily_usage
  ADD COLUMN IF NOT EXISTS stream_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.user_daily_usage.stream_count IS
  'Realtime stream sessions today (UTC day key). Hard cap for PREMIUM; 0 for FREE (no streaming).';

-- ─── check_preflight: add the stream branch ─────────────────────────────
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
  p_premium_speech_chars_limit INT DEFAULT 15000,
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
    WHEN v_is_pro AND p_type NOT IN ('speech', 'stream') THEN p_premium_throttle_threshold
    ELSE 0
    END;

  -- Defense in depth: a NON-pro user (authoritative tier from the DB) must
  -- never stream when FREE has no streaming entitlement. The worker guard
  -- normally blocks this with 403 first; this catches a stale PREMIUM JWT
  -- after the subscription lapsed.
  IF NOT v_is_pro AND p_type = 'stream' AND v_daily_limit <= 0 THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'QUOTA_EXCEEDED',
      'quota_total', 0,
      'quota_remaining', 0
    );
  END IF;

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
  ELSIF v_daily_limit > 0 AND p_type = 'stream' THEN
    SELECT stream_count INTO v_used
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
  'Cooldown + daily quota gate with the authoritative tier derived from user_subscriptions (same predicate as the access token hook). translate/transcribe count requests; speech charges p_charge_chars characters against p_premium_speech_chars_limit and may land exactly on the cap; stream counts sessions (+1 each) against the daily limit passed in p_free/p_premium_daily_limit and is hard-denied for non-pro users when FREE has no streaming. Service_role only.';

-- ─── consume_usage: charge the stream session counter ───────────────────
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

  INSERT INTO public.user_daily_usage (user_id, day, translate_count, transcribe_count, speech_chars, stream_count, updated_at)
  VALUES (
    p_user_id, v_day,
    CASE WHEN p_type = 'translate' THEN 1 ELSE 0 END,
    CASE WHEN p_type = 'transcribe' THEN 1 ELSE 0 END,
    CASE WHEN p_type = 'speech' THEN p_chars ELSE 0 END,
    CASE WHEN p_type = 'stream' THEN 1 ELSE 0 END,
    now()
  )
  ON CONFLICT (user_id, day) DO UPDATE
  SET
    translate_count = CASE WHEN p_type = 'translate' THEN public.user_daily_usage.translate_count + 1 ELSE public.user_daily_usage.translate_count END,
    transcribe_count = CASE WHEN p_type = 'transcribe' THEN public.user_daily_usage.transcribe_count + 1 ELSE public.user_daily_usage.transcribe_count END,
    speech_chars = CASE WHEN p_type = 'speech' THEN public.user_daily_usage.speech_chars + p_chars ELSE public.user_daily_usage.speech_chars END,
    stream_count = CASE WHEN p_type = 'stream' THEN public.user_daily_usage.stream_count + 1 ELSE public.user_daily_usage.stream_count END,
    updated_at = now()
  RETURNING CASE
    WHEN p_type = 'translate' THEN translate_count
    WHEN p_type = 'transcribe' THEN transcribe_count
    WHEN p_type = 'stream' THEN stream_count
    ELSE speech_chars
  END INTO v_count;

  RETURN jsonb_build_object('count', v_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_usage(uuid, text, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_usage(uuid, text, int) TO service_role;

COMMENT ON FUNCTION public.consume_usage(uuid, text, int) IS
  'Atomically increments today''s counter for the given request type (translate/transcribe +1, speech +p_chars characters, stream +1 per session). Service_role only.';

-- ─── get_daily_usage: unchanged (stream is enforcement-only) ────────────
-- Re-declared here so this migration is the DB's full end-state contract for
-- all three quota RPCs (the rpc-contract keystone test reads a single file).
-- Stream is intentionally NOT surfaced in the /usage snapshot until the meter
-- becomes user-visible (see the "stream meter visibility" product decision).
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
  'Read-only today counters (translate/transcribe/speech chars) for /usage. Limits come from the Worker (plans.ts), not SQL.';