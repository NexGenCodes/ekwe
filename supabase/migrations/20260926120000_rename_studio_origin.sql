-- Rename the `studio` origin to `speech-studio`.
--
-- The surface's name changed to "Speech Studio" in the app; `origin` is the
-- product feature that produced a row, so the stored value follows. `"studio"`
-- also collided with `STUDIO_VOICE_ID` — a voice id — and the two are unrelated
-- fields that happened to share a string.
--
-- The column is plain TEXT with no CHECK constraint, so this is the whole
-- migration. No legacy sentinel map is kept for the old value: the column was
-- introduced as `NOT NULL DEFAULT 'echo'`, so any row that predates it was
-- already backfilled with a valid value and could never have been served by a
-- fallback map anyway.
--
-- Telemetry is deliberately NOT migrated. `result_shared`'s `source` property
-- is a frozen reporting contract (`TelemetrySource`) and keeps `"studio"` so
-- existing dashboards do not break.
--
-- Status against production (2026-09-26): a no-op. All 303 history rows are
-- already `echo`; nothing was ever written as `studio`, so this updates 0 rows.
-- It is kept for environments that ran the intermediate build which did write
-- `studio`. Re-running is harmless.
--
-- Note this file is not in `meta/_journal.json`, so `drizzle-kit migrate` will
-- not apply it. The hand-written SQL files in this directory are being applied
-- outside Drizzle's tracking; reconciling that is separate from this rename.

UPDATE public.history
SET origin = 'speech-studio'
WHERE origin = 'studio';
