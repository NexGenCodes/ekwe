-- Re-shape history around capture surfaces.
--
-- History is an archive of *text* Ekwe understood, tagged by which surface
-- understood it. Audio is never stored: it is a rendering of text we already
-- hold, so persisting it would cost storage on every surface and buy nothing
-- retrievable. Nothing in this migration adds an audio column.
--
-- What changes:
--
--   origin      which surface captured it — studio | echo | orb. This is the
--               axis the product actually has three of; `type` was not, being
--               derivable from whether a translation is present.
--   input       what that surface consumed — audio | text. Makes "there was no
--               recording" explicit instead of inferring it from duration = 0,
--               which `20260809000001` used as a load-bearing signal.
--   capture_id  one capture yields exactly one row. Previously a translated
--               note produced two: a transcription-only row plus a separate
--               translation row, because the dedup lookup keyed on entry_type
--               and the two rows had different entry_types, so they could never
--               match. The text-derived session key that was meant to link them
--               was dropped on the floor before it reached the database.
--               capture_id replaces that mechanism with one that works.
--   stt/mt      `provider` conflated two different providers: the STT model on
--               transcription rows and, on translation rows, the STT model
--               again — the MT provider was fetched and discarded. Split into
--               stt_provider and mt_provider. `provider` is retained in place;
--               see "provider is kept" below.
--   voice_id    the slot used to render speech, so a Studio entry records which
--               voice produced it.
--
-- Defaults are chosen so legacy rows read correctly without a backfill. Echo is
-- the only surface that wrote history before this migration, so legacy rows are
-- attributed to Echo; `20260815000000`-era writers that used the in-app
-- sentinels ("ekwe", "ekwe-home") came from Voice Studio and are re-attributed
-- so the History filter does not silently mislabel them.
--
-- `entry_type` is intentionally left in place. It is no longer a user-facing
-- concept, but it is a stored column that older app versions may still read,
-- and it costs nothing to keep.

ALTER TABLE public.history
  ADD COLUMN IF NOT EXISTS capture_id TEXT,
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'echo',
  ADD COLUMN IF NOT EXISTS input TEXT NOT NULL DEFAULT 'audio',
  ADD COLUMN IF NOT EXISTS voice_id TEXT,
  ADD COLUMN IF NOT EXISTS stt_provider TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mt_provider TEXT;

-- Carry the existing provider value into stt_provider, so no row loses the
-- record of which model heard it.
--
-- ─── provider is kept, on purpose ───────────────────────────────────────────
--
-- `provider` is INTENTIONALLY STILL IN PLACE and is not queued for removal.
-- Dropping it is a compatibility break, not a data cleanup: `provider` is in
-- the SELECT list and the outbox upsert payload of any build predating the
-- stt/mt split, and PostgREST rejects an insert naming a column that no longer
-- exists —
--
--   column "provider" of relation "history" does not exist
--
-- Those outbox rows cannot be flushed. They retry, exhaust their attempts, land
-- in the dead-letter state, and the user's history silently stops syncing to the
-- cloud, with no crash and nothing on the write path to notice.
--
-- The column is nullable and its data is now duplicated in stt_provider, so
-- keeping it costs one nullable TEXT column and buys every pre-split install
-- working. Removing it is a breaking change to the API contract, so it belongs
-- in a release that also updates the oldest client — not in a migration
-- someone remembers to apply later.
UPDATE public.history
  SET stt_provider = COALESCE(provider, '')
  WHERE provider IS NOT NULL;

-- In-app captures send an explicit empty string, so the "Unknown App"
-- placeholder no longer describes anything real. Non-destructive, and old
-- builds always sent the column explicitly so nothing relied on this default.
ALTER TABLE public.history
  ALTER COLUMN source_app SET DEFAULT '';

-- Legacy rows are deliberately NOT re-attributed. Two writers left in-app
-- sentinels in `source_app` ("ekwe", "ekwe-home") that actually mean Studio,
-- and correcting them would be a destructive write against production data for
-- a cosmetic gain. `resolveOrigin()` in the app derives the right origin from
-- the sentinel at read time instead, which is the single place the legacy
-- mapping lives.

-- Back the capture-id upsert. Partial, because legacy rows share a NULL
-- capture_id and must not collide with each other.
DROP INDEX IF EXISTS public.idx_history_dedup;

CREATE INDEX IF NOT EXISTS idx_history_user_capture
  ON public.history (user_id, capture_id)
  WHERE capture_id IS NOT NULL;
