-- Add the producing-operation type to history.
--
-- A user either transcribes (audio → text) or translates (text → text), never
-- both at once. The `type` column records which operation produced the entry:
--   - 'transcription' → started from audio (may later carry a derived translation)
--   - 'translation'   → text in / text out
--
-- Legacy rows are backfilled from content + duration: a row with a distinct
-- translation and no audio duration is a pure text translation; everything
-- else originated from audio.

ALTER TABLE public.history
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'transcription';

UPDATE public.history
SET type = 'translation'
WHERE type = 'transcription'
  AND translation_text IS NOT NULL
  AND translation_text != ''
  AND translation_text != transcript
  AND duration = 0;