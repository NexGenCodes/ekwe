-- Add missing UPDATE policy for history table
-- Without this, SyncService.updateHistoryTranslation() silently fails to sync to cloud
CREATE POLICY "Users can update own history"
  ON public.history FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
