-- Cooldown state migrated to KV (expirationTtl-based).
-- user_cooldowns and sync_cooldowns are no longer written to.
-- KV keys: cdwn:<userId> (request cooldown), scdwn:<userId> (sync-push cooldown).

DROP TABLE IF EXISTS user_cooldowns;
DROP TABLE IF EXISTS sync_cooldowns;
