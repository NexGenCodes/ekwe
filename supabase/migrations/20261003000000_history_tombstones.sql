-- Tombstones, so undo cannot resurrect a row another device deleted.
--
-- The revision work in 20261002000000 made *writes* safe against a stale
-- device, but deletes were left as an unconditional
-- `supabase.from("history").delete()`, and that has two failure modes:
--
--   * A delete is not arbitrated at all. Any device can remove any of its own
--     rows regardless of what it knew about them when it decided to.
--   * There is no record that a row was ever deleted. So a row removed on
--     device A is invisible to device B, whose next write finds "not found" and
--     takes the insert branch of history_upsert_if_fresh. The row comes back,
--     silently undoing a delete the user made on another device.
--
-- The second is the one users would notice: delete a capture on your phone, and
-- it reappears because your laptop synced afterwards.
--
-- `deleted_at` makes a delete a fact the server keeps instead of a hole in the
-- table:
--
--   * `history_delete_if_fresh` stamps `deleted_at` and bumps `revision`, so a
--     delete is arbitrated exactly like an upsert and can be refused as stale.
--   * `history_upsert_if_fresh` refuses to insert over a tombstone. It returns
--     outcome `deleted` instead, and the client drops its local copy rather
--     than resurrecting the row.
--   * A restore is a deliberate un-delete: the client sends the revision it
--     holds, and the row comes back with `deleted_at` cleared.
--
-- The row is kept rather than erased so all three of those are decidable. A
-- tombstone is invisible to reads (`deleted_at is null` filters it out of every
-- query the client makes) and to realtime INSERT/UPDATE handling, so this is
-- invisible in normal use. It costs one row per deletion until
-- `history_purge_tombstones` runs.
--
-- delete_all goes through `history_delete_all`, which tombstones rather than
-- hard-deletes. A hard delete here would be the same resurrection bug on the
-- widest scale: any device that had not yet synced would re-push everything the
-- user had just cleared.

ALTER TABLE public.history
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial index: only live rows need to be found by the queries the client
-- actually runs, and this keeps the index small as tombstones accumulate.
CREATE INDEX IF NOT EXISTS idx_history_live_user
  ON public.history (user_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- `updated_at` already has a BEFORE UPDATE trigger from the previous migration,
-- so stamping deleted_at refreshes it and the row sorts correctly by recency.

-- Applies a batch of deletes as tombstones, refusing any whose base_revision is
-- stale, so a device deleting a row it has not caught up with cannot remove a
-- newer edit.
--
-- SECURITY INVOKER, matching history_upsert_if_fresh: RLS limits this to the
-- caller's own rows and nothing here needs to bypass it.
--
-- Returns one row per input id. A row that was already deleted reports
-- `already_deleted`, which settles the outbox entry without needing to fail or
-- retry -- the caller's intent is satisfied either way.
CREATE OR REPLACE FUNCTION public.history_delete_if_fresh(p_rows JSONB)
RETURNS TABLE (
  id TEXT,
  outcome TEXT,
  revision INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_input  JSONB;
  v_id     TEXT;
  v_base   INTEGER;
  v_user   UUID;
  v_stored public.history;
BEGIN
  v_user := auth.uid();

  FOR v_input IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_id := v_input ->> 'id';
    v_base := NULLIF(v_input ->> 'base_revision', '')::INTEGER;

    IF v_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_stored
      FROM public.history
      WHERE history.id = v_id AND history.user_id = v_user
      FOR UPDATE;

    -- Never existed, or already gone: nothing to do and nothing to refuse.
    IF NOT FOUND THEN
      id := v_id;
      outcome := 'already_deleted';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_stored.deleted_at IS NOT NULL THEN
      id := v_id;
      outcome := 'already_deleted';
      revision := v_stored.revision;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Same rule as an upsert: a payload from an older build carries no
    -- base_revision and is applied rather than refused.
    IF v_base IS NOT NULL AND v_base <> v_stored.revision THEN
      id := v_id;
      outcome := 'conflict';
      revision := v_stored.revision;
      RETURN NEXT;
      CONTINUE;
    END IF;

    UPDATE public.history
      SET deleted_at = now(),
          revision = history.revision + 1
      WHERE public.history.id = v_id AND public.history.user_id = v_user
      RETURNING * INTO v_stored;

    id := v_id;
    outcome := 'deleted';
    revision := v_stored.revision;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.history_delete_if_fresh(JSONB) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.history_delete_if_fresh(JSONB) TO authenticated;

-- Tombstones every live row belonging to the caller.
--
-- "Delete everything" has no per-row base_revision to arbitrate against, so
-- there is nothing to refuse: the user's intent is that none of their history
-- survives. It still goes through a tombstone rather than a hard delete,
-- because a hard delete leaves nothing behind and the next write from any
-- device that had not yet synced re-inserted the rows the user had just
-- cleared -- the same resurrection this migration exists to prevent, applied to
-- the one action where it would wipe the most data.
--
-- Returns the number of rows tombstoned, so the client can log what happened
-- rather than assuming the wipe landed.
--
-- SECURITY INVOKER, like the other two client-facing functions: RLS is what
-- confines this to the caller's own rows.
CREATE OR REPLACE FUNCTION public.history_delete_all()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_user  UUID := auth.uid();
  v_count INTEGER;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'history_delete_all requires an authenticated user';
  END IF;

  UPDATE public.history
    SET deleted_at = now(),
        revision = history.revision + 1
    WHERE user_id = v_user
      AND deleted_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.history_delete_all() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.history_delete_all() TO authenticated;

-- Replaces history_upsert_if_fresh from the previous migration with two
-- additions:
--
--   * A tombstoned row is never re-inserted. The outcome is `deleted` and the
--     server row comes back, so the client can drop its local copy instead of
--     pushing the same state again on every later edit.
--   * `restore: true` clears the tombstone. This is the only way a deleted row
--     comes back, which is what makes undo on one device able to undo a delete
--     the user made deliberately, rather than resurrecting it by accident.
--
-- The same signature and row shape as before, so the existing grants and the
-- client's result handling both carry over.
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
  v_restore BOOLEAN;
  v_user    UUID;
  v_stored  public.history;
BEGIN
  v_user := auth.uid();

  FOR v_input IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_id := v_input ->> 'id';
    v_base := NULLIF(v_input ->> 'base_revision', '')::INTEGER;
    v_restore := COALESCE((v_input ->> 'restore')::BOOLEAN, FALSE);

    IF v_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_stored
      FROM public.history
      WHERE history.id = v_id AND history.user_id = v_user
      FOR UPDATE;

    -- A row that is not there at all, and was never tombstoned: a genuine
    -- insert. Note a tombstoned row *is* found by the lookup above, so it
    -- cannot reach this branch -- that is the whole point of the tombstone.
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

    -- Tombstoned. An ordinary write must not bring it back; only an explicit
    -- restore may, and only if the caller's revision still matches.
    IF v_stored.deleted_at IS NOT NULL THEN
      IF NOT v_restore THEN
        id := v_id;
        outcome := 'deleted';
        revision := v_stored.revision;
        server_row := to_jsonb(v_stored);
        RETURN NEXT;
        CONTINUE;
      END IF;

      IF v_base IS NOT NULL AND v_base <> v_stored.revision THEN
        id := v_id;
        outcome := 'conflict';
        revision := v_stored.revision;
        server_row := to_jsonb(v_stored);
        RETURN NEXT;
        CONTINUE;
      END IF;

      UPDATE public.history
        SET deleted_at = NULL,
            capture_id = COALESCE(NULLIF(v_input ->> 'capture_id', ''), history.capture_id),
            transcript = COALESCE(v_input ->> 'transcript', history.transcript),
            translation_text = COALESCE(NULLIF(v_input ->> 'translation_text', ''), history.translation_text),
            transliteration_text = COALESCE(NULLIF(v_input ->> 'transliteration_text', ''), history.transliteration_text),
            duration = COALESCE((v_input ->> 'duration')::REAL, history.duration),
            mt_provider = COALESCE(NULLIF(v_input ->> 'mt_provider', ''), history.mt_provider),
            revision = history.revision + 1
        WHERE public.history.id = v_id AND public.history.user_id = v_user
        RETURNING * INTO v_stored;

      id := v_id;
      outcome := 'restored';
      revision := v_stored.revision;
      server_row := to_jsonb(v_stored);
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_base IS NULL OR v_base = v_stored.revision THEN
      UPDATE public.history
        SET type = COALESCE(NULLIF(v_input ->> 'type', ''), history.type),
            capture_id = COALESCE(NULLIF(v_input ->> 'capture_id', ''), history.capture_id),
            origin = COALESCE(NULLIF(v_input ->> 'origin', ''), history.origin),
            input = COALESCE(NULLIF(v_input ->> 'input', ''), history.input),
            source_lang = v_input ->> 'source_lang',
            target_lang = v_input ->> 'target_lang',
            transcript = COALESCE(v_input ->> 'transcript', history.transcript),
            translation_text = NULLIF(v_input ->> 'translation_text', ''),
            transliteration_text = NULLIF(v_input ->> 'transliteration_text', ''),
            duration = COALESCE((v_input ->> 'duration')::REAL, history.duration),
            source_app = COALESCE(v_input ->> 'source_app', history.source_app),
            voice_id = COALESCE(NULLIF(v_input ->> 'voice_id', ''), history.voice_id),
            stt_provider = COALESCE(v_input ->> 'stt_provider', history.stt_provider),
            mt_provider = COALESCE(NULLIF(v_input ->> 'mt_provider', ''), history.mt_provider),
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

-- Housekeeping for tombstones. Kept as a function rather than a scheduled
-- migration because the retention window is a judgement call, not a schema
-- fact, and a wrong guess here would either grow without bound or delete a
-- tombstone still protecting a row from resurrection.
--
-- SECURITY DEFINER is required and is the one place in this migration that
-- needs it: there is no RLS policy that lets a user delete rows by age, and this
-- must reach rows the caller does not own. It therefore takes no caller-supplied
-- interval, refuses to run for a non-service role, and always keeps at least
-- the window the RPCs rely on.
CREATE OR REPLACE FUNCTION public.history_purge_tombstones()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ := now() - INTERVAL '30 days';
  v_count  INTEGER;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'history_purge_tombstones is service_role only';
  END IF;

  DELETE FROM public.history
    WHERE deleted_at IS NOT NULL
      AND deleted_at < v_cutoff;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.history_purge_tombstones() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.history_purge_tombstones() TO service_role;

COMMENT ON COLUMN public.history.deleted_at IS
  'Set when the row is deleted. The row is retained as a tombstone so a delete cannot be undone by another device syncing later, and so restore can distinguish an intentional un-delete from an accidental resurrect. NULL means the row is live; every read filters on that.';
COMMENT ON FUNCTION public.history_delete_if_fresh(JSONB) IS
  'Applies a batch of deletes as tombstones, refusing any whose base_revision no longer matches. Returns per-row outcome (deleted | already_deleted | conflict) with the server''s revision.';
COMMENT ON FUNCTION public.history_upsert_if_fresh(JSONB) IS
  'Applies a batch of history upserts, refusing any whose base_revision no longer matches the stored revision. A tombstoned row is not resurrected: it returns outcome deleted unless the payload sets restore, which clears the tombstone. Returns per-row outcome (inserted | applied | restored | conflict | deleted) with the server''s current row in server_row.';
COMMENT ON FUNCTION public.history_purge_tombstones() IS
  'Deletes tombstones older than 30 days. service_role only; call from a scheduled job.';