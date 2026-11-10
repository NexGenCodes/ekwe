CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'flutterwave',
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  user_id TEXT,
  tx_ref TEXT,
  flw_ref TEXT,
  external_id TEXT,
  amount REAL,
  currency TEXT,
  plan TEXT,
  platform TEXT,
  message TEXT,
  detail TEXT,
  occurred_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_events_user_created
  ON billing_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_events_status_created
  ON billing_events (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_events_type_created
  ON billing_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_events_created
  ON billing_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_events_tx_ref
  ON billing_events (tx_ref);

CREATE INDEX IF NOT EXISTS idx_billing_events_flw_ref
  ON billing_events (flw_ref);
