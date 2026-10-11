-- Conflict-safe history sync.
--
-- The problem this fixes: `history` rows were pushed with an unconditional
-- `supabase.from("history").upsert(...)`, so a device that had been offline
-- with an old copy of a row would overwrite whatever a newer device had since
-- written. Last-write-wins with client clocks is not last-write-wins at all --
-- an older payload that arrives later simply wins, and the translation the user
-- most recently made disappears from every other device.
--
-- `updated_at` cannot arbitrate this. It was added in
-- 20260618000001_add_updated_at_to_history with a DEFAULT of now(), which only
-- sets it on INSERT -- nothing ever updated it afterwards, so on any row that
-- had been updated it still held the creation time.
--
-- The fix is a server-assigned monotonic `revision`:
--
--   * The client sends `base_revision`: the revision it believed was current
--     when it made the edit.
--   * The server applies the write only when `base_revision` still matches the
--     stored `revision`, and bumps `revision` on every applied write.
--   * When it does not match, the write is refused and the server row is
--     returned as-is. The client then adopts the server row. The server is
--     authoritative, so a refused write loses rather than silently overwriting.
--
-- `base_revision` is optional in the payload. A payload enqueued by an older
-- app version carries none, and must keep working rather than being retried to
-- death, so those rows fall back to the old last-write-wins behaviour. New
-- payloads always send it, which is what makes the race detectable.

ALTER TABLE public.history
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;

-- `updated_at` has to be truthful for `idx_history_updated_at` to mean
-- anything, so maintain it on update instead of leaving it at insert time.
CREATE OR REPLACE FUNCTION public.history_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS history_touch_updated_at ON public.history;

CREATE TRIGGER history_touch_updated_at
  BEFORE UPDATE ON public.history
  FOR EACH ROW
  EXECUTE FUNCTION public.history_touch_updated_at();

-- Applies a batch of client writes, refusing any whose base_revision is stale.
--
-- SECURITY INVOKER on purpose: the table's RLS policies already restrict reads
-- and writes to `auth.uid() = user_id`, so the caller can only ever touch its own
-- rows. SECURITY DEFINER would bypass exactly that check, and nothing here needs
-- it to.
--
-- Each row is locked FOR UPDATE before its revision is read, so two devices
-- draining at the same moment serialise instead of both reading the same
-- revision and both believing they won.
--
-- `p_rows` is a JSON array of objects carrying the upsert payload's columns plus
-- an optional `base_revision`. Returns one row per input id with the outcome and
-- the server's current state, so a refused write can be reconciled without a
-- second round trip.
CREATE OR REPLACE FUNCTION public.history_upsert_if_fresh(p_rows JSONB)
RETURNS TABLE (
  id TEXT,
  outcome TEXT,
  revision INTEGER,
  server_row JSONB
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_input   JSONB;
  v_id      TEXT;
  v_base    INTEGER;
  v_user    UUID;
  v_stored  public.history;
BEGIN
  v_user := auth.uid();

  FOR v_input IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_id := v_input ->> 'id';
    v_base := NULLIF(v_input ->> 'base_revision', '')::INTEGER;

    -- Absent from the batch, or not ours: nothing to arbitrate, nothing to write.
    IF v_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_stored
      FROM public.history
      WHERE history.id = v_id AND history.user_id = v_user
      FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.history (
        id, user_id, type, capture_id, origin, input, source_lang, target_lang,
        transcript, translation_text, transliteration_text, duration, source_app,
        voice_id, stt_provider, mt_provider, created_at
      )
      VALUES (
        v_id, v_user,
        COALESCE(v_input ->> 'type', 'transcription'),
        NULLIF(v_input ->> 'capture_id', ''),
        COALESCE(NULLIF(v_input ->> 'origin', ''), 'echo'),
        COALESCE(NULLIF(v_input ->> 'input', ''), 'audio'),
        v_input ->> 'source_lang',
        v_input ->> 'target_lang',
        COALESCE(v_input ->> 'transcript', ''),
        NULLIF(v_input ->> 'translation_text', ''),
        NULLIF(v_input ->> 'transliteration_text', ''),
        COALESCE((v_input ->> 'duration')::REAL, 0),
        COALESCE(v_input ->> 'source_app', ''),
        NULLIF(v_input ->> 'voice_id', ''),
        COALESCE(v_input ->> 'stt_provider', ''),
        NULLIF(v_input ->> 'mt_provider', ''),
        COALESCE((v_input ->> 'created_at')::TIMESTAMPTZ, now())
      )
      RETURNING * INTO v_stored;

      id := v_id;
      outcome := 'inserted';
      revision := v_stored.revision;
      server_row := to_jsonb(v_stored);
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- A payload from an older app version carries no base_revision. Keep the
    -- previous behaviour for it so an in-flight queue from a previous build is
    -- not dead on arrival, rather than letting it block on a revision it has
    -- no way to know.
    IF v_base IS NULL OR v_base = v_stored.revision THEN
      UPDATE public.history
        SET type = COALESCE(NULLIF(v_input ->> 'type', ''), history.type),
            capture_id = NULLIF(v_input ->> 'capture_id', ''),
            origin = COALESCE(NULLIF(v_input ->> 'origin', ''), history.origin),
            input = COALESCE(NULLIF(v_input ->> 'input', ''), history.input),
            source_lang = v_input ->> 'source_lang',
            target_lang = v_input ->> 'target_lang',
            transcript = COALESCE(v_input ->> 'transcript', history.transcript),
            translation_text = NULLIF(v_input ->> 'translation_text', ''),
            transliteration_text = NULLIF(v_input ->> 'transliteration_text', ''),
            duration = COALESCE((v_input ->> 'duration')::REAL, history.duration),
            source_app = COALESCE(v_input ->> 'source_app', history.source_app),
            voice_id = NULLIF(v_input ->> 'voice_id', ''),
            stt_provider = COALESCE(v_input ->> 'stt_provider', history.stt_provider),
            mt_provider = NULLIF(v_input ->> 'mt_provider', ''),
            revision = history.revision + 1
        WHERE public.history.id = v_id AND public.history.user_id = v_user
        RETURNING * INTO v_stored;

      id := v_id;
      outcome := 'applied';
      revision := v_stored.revision;
      server_row := to_jsonb(v_stored);
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Stale: the row moved on after this client last saw it. Leave the server
    -- row alone and hand it back so the client can adopt it.
    id := v_id;
    outcome := 'conflict';
    revision := v_stored.revision;
    server_row := to_jsonb(v_stored);
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.history_upsert_if_fresh(JSONB) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.history_upsert_if_fresh(JSONB) TO authenticated;

COMMENT ON COLUMN public.history.revision IS
  'Server-assigned monotonic version, bumped on every applied write. The client sends the revision it based its edit on as base_revision; a mismatch means the write is stale and is refused.';
COMMENT ON FUNCTION public.history_upsert_if_fresh(JSONB) IS
  'Applies a batch of history upserts, refusing any whose base_revision no longer matches the stored revision. Returns per-row outcome (inserted | applied | conflict) with the server''s current row in server_row.';
