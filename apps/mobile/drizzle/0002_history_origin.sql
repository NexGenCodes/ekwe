ALTER TABLE `history` ADD COLUMN `capture_id` text;--> statement-breakpoint
ALTER TABLE `history` ADD COLUMN `origin` text DEFAULT 'echo' NOT NULL;--> statement-breakpoint
ALTER TABLE `history` ADD COLUMN `input` text DEFAULT 'audio' NOT NULL;--> statement-breakpoint
ALTER TABLE `history` ADD COLUMN `voice_id` text;--> statement-breakpoint
ALTER TABLE `history` ADD COLUMN `mt_provider` text;--> statement-breakpoint
ALTER TABLE `history` ADD COLUMN `stt_provider` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `history` SET `stt_provider` = `provider`;--> statement-breakpoint
ALTER TABLE `history` DROP COLUMN `provider`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_history_dedup`;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_history_user_capture` ON `history` (`user_id`,`capture_id`);