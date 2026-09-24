DROP INDEX IF EXISTS `idx_history_user_created`;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_history_dedup` ON `history` (`user_id`,`entry_type`,`source_lang`,`target_lang`,`transcript`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_history_user_created` ON `history` (`user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_outbox_pending` ON `outbox` (`user_id`,`status`,`retries`);