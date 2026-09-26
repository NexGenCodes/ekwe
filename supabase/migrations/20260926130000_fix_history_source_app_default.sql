-- Set history.source_app's default to the empty string, for real this time.
--
-- `20260926010000_add_history_origin.sql` already contains this exact
-- statement. It did not take effect in production, and the reason is worth
-- writing down because it will happen again.
--
-- The Supabase CLI records a migration as applied by VERSION — the
-- `YYYYMMDDHHMMSS` prefix parsed out of the filename. It stores no checksum of
-- the file's contents. So when that statement was added to
-- `20260926010000` after the file had already been applied, the CLI had no way
-- to notice: the version was unchanged, therefore the migration was applied,
-- therefore the edited body was never re-run. The rest of that file's
-- statements had been applied earlier, so the file looked correct and the one
-- missing line was invisible to every tool in the chain.
--
-- Confirmed against production on 2026-09-26: the column default was still
-- 'Unknown App' (from `20260415000000_create_history.sql`) while the file
-- claimed ''. This migration is the forward fix. The rule it implies: never
-- edit a migration that has been applied — add a new one.
--
-- Effect: an insert that omits `source_app` no longer records the literal
-- "Unknown App". In-app captures have always sent the column explicitly, so
-- this only affects writers that leave it out. No existing row is touched, and
-- the column stays NOT NULL — an explicit NULL is still rejected, which is the
-- intent; the default is what was wrong.

ALTER TABLE public.history
  ALTER COLUMN source_app SET DEFAULT '';
