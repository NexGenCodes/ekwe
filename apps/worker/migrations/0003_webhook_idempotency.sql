-- Webhook idempotency table for Ekwe.
-- Allows an ATOMIC claim of a webhook event id (KV get-then-put was racy, so
-- duplicate deliveries could both pass the guard). D1 INSERT ... ON CONFLICT
-- DO NOTHING is atomic: only one request inserts the key (wins the race);
-- concurrent duplicates change zero rows and are dropped. An index on
-- expires_at lets the cron cleanup reclaim rows in one pass.

CREATE TABLE IF NOT EXISTS webhook_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_idempotency_expires
  ON webhook_idempotency(expires_at);
