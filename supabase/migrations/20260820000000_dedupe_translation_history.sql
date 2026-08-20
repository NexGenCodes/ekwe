-- One-time cleanup of duplicate translation history rows.
--
-- Client-side dedup (SyncService.writeHistory) now re-uses an existing row
-- when a text translation is recorded again with the same
-- (source_lang, target_lang, transcript), so new duplicates should not be
-- created. This migration removes duplicates that already exist in the cloud,
-- keeping the most recently created row per dedup key.
--
-- Deliberately NO unique index here: enforcing uniqueness in the DB would make
-- the offline outbox a source of dead rows when a user edits + re-records the
-- same translation across devices before a sync, or when two devices record
-- the same text concurrently. Client-side idempotency is the enforcement
-- point; this migration only cleans up what's already on disk.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, source_lang, target_lang, transcript
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM public.history
  WHERE type = 'translation'
)
DELETE FROM public.history
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);