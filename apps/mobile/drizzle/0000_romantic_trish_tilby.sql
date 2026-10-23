-- Drizzle schema snapshot for the local SQLite schema
-- (apps/mobile/src/db/schema.ts), plus the FTS5 full-text search table.
-- Statements are idempotent (IF NOT EXISTS) so a pre-existing ekwe.db written
-- by the legacy op-sqlite layer migrates in place without data loss.
CREATE TABLE IF NOT EXISTS `history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_lang` text NOT NULL,
	`target_lang` text NOT NULL,
	`transcript` text NOT NULL,
	`translation_text` text,
	`transliteration_text` text,
	`duration` real DEFAULT 0 NOT NULL,
	`source_app` text DEFAULT '' NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`entry_type` text DEFAULT 'transcription' NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_history_created` ON `history` (`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_history_user` ON `history` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_history_user_created` ON `history` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`user_id` text NOT NULL,
	`retries` integer DEFAULT 0 NOT NULL,
	`last_attempt` integer,
	`created_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_outbox_status` ON `outbox` (`status`);
--> statement-breakpoint
-- FTS5 full-text search over history. Contentful table shape matches the one
-- ensureTables() used (a contentless/external-content shape would make the raw
-- FTS 'delete' write command invalid on the sync path). Triggers that keep it
-- in sync are reconciled at runtime by repairFtsTriggers, since SQLite cannot
-- CREATE TRIGGER IF NOT EXISTS.
CREATE VIRTUAL TABLE IF NOT EXISTS `history_fts` USING fts5(
	`id` UNINDEXED,
	`transcript`,
	`translation_text`
);