-- Composite index for the dominant history-list query.
--
-- The mobile client lists history as `WHERE user_id = ? ORDER BY created_at
-- DESC` (with a `(created_at, id)` composite cursor; see SyncService
-- fetchOlderHistory / historyChunks). The existing single-column indexes
-- (idx_history_user_id, idx_history_created_at) cannot serve the filtered
-- sort, so Postgres bitmap-scans or sorts the user's whole history on every
-- page. This index covers both the filter and the sort.

CREATE INDEX IF NOT EXISTS idx_history_user_created
  ON public.history (user_id, created_at DESC);