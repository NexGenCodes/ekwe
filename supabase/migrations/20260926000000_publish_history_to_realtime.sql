-- Realtime support for public.history.
--
-- Part 1 — publication membership (idempotent, currently a no-op).
--
-- This was originally written on the assumption that public.history was never
-- added to the `supabase_realtime` publication, which would have explained a
-- permanent CHANNEL_ERROR on the client's postgres_changes subscribe. That
-- turned out to be FALSE: verified against the live database on 2026-09-26,
-- public.history was already a member of supabase_realtime. The statement is
-- kept because it is idempotent and makes the required state explicit for
-- freshly provisioned environments, but it is NOT the CHANNEL_ERROR fix.
--
-- RLS is correct for realtime: subscriptions are authorized using the
-- subscriber's SELECT policy, and "Users can read own history"
-- (auth.uid() = user_id) is in place. No policy or grant changes are needed —
-- least privilege is unchanged.
--
-- Part 2 — replica identity (this is the real fix below).
--
-- Idempotent: ALTER PUBLICATION has no IF NOT EXISTS, so guard on
-- pg_publication_tables.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'history'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.history;
  END IF;
END
$$;

-- Replica identity: the client DELETE handler reads payload.old.id to work out
-- which local row to remove:
--
--   const oldRow = payload.old as { id?: string };
--   if (!oldRow.id) return;
--
-- With the default replica identity (DEFAULT), UPDATE and DELETE events carry
-- an EMPTY old record, so that guard always bailed and deletes were silently
-- dropped. FULL puts the pre-change tuple in the event.
--
-- Cost is bounded: history rows are small text columns, and this table's write
-- volume is per-transcription rather than per-keystroke.

ALTER TABLE public.history REPLICA IDENTITY FULL;
