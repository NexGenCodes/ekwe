-- The upload cap in packages/shared/src/plans.ts (PREMIUM_LIMITS.maxAudioBytes)
-- dropped to 10MB so a Whisper request fits the 128MB per-isolate ceiling. This
-- bucket was created at the old 25MB cap; storage enforces its own limit, so it
-- has to follow or it would silently accept files the app now rejects.
update storage.buckets
set file_size_limit = 10485760
where id = 'voice_notes';
