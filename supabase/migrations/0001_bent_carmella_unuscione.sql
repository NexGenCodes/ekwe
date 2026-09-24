ALTER POLICY "Users can insert own history" ON "history" TO public WITH CHECK ((auth.uid() = user_id));--> statement-breakpoint
ALTER POLICY "Users can read own history" ON "history" TO public USING ((auth.uid() = user_id));--> statement-breakpoint
ALTER POLICY "Users can update own history" ON "history" TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));--> statement-breakpoint
ALTER POLICY "Service role can manage push_tokens" ON "push_tokens" TO service_role USING (TRUE) WITH CHECK (TRUE);