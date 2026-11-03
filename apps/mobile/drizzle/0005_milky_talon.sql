ALTER TABLE `history` ADD `dirty` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `history` ADD `restore` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `history` SET `dirty` = 1 WHERE `revision` = 0 OR `id` IN (SELECT json_extract(`payload`, '$.id') FROM `outbox`);--> statement-breakpoint
DROP TABLE `outbox`;--> statement-breakpoint
CREATE INDEX `idx_history_user_dirty` ON `history` (`user_id`,`dirty`,`created_at`);
