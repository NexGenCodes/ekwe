-- Richer billing ledger: payment attempts, refunds, disputes/chargebacks, and provider snapshots.

CREATE TABLE IF NOT EXISTS billing_payment_attempts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'flutterwave',
  user_id TEXT,
  tx_ref TEXT,
  flw_ref TEXT,
  transaction_id TEXT,
  charge_id TEXT,
  event_type TEXT,
  status TEXT NOT NULL, -- pending|succeeded|failed|abandoned|cancelled|refunded|disputed|unknown
  amount REAL,
  currency TEXT,
  plan TEXT,
  payment_type TEXT,
  processor_response TEXT,
  customer_email TEXT,
  narrative TEXT,
  raw_json TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_payment_attempts_provider_txref
  ON billing_payment_attempts (provider, tx_ref) WHERE tx_ref IS NOT NULL AND tx_ref <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_payment_attempts_provider_txid
  ON billing_payment_attempts (provider, transaction_id) WHERE transaction_id IS NOT NULL AND transaction_id <> '';
CREATE INDEX IF NOT EXISTS idx_billing_payment_attempts_user_updated
  ON billing_payment_attempts (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_payment_attempts_status_updated
  ON billing_payment_attempts (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS billing_refunds (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'flutterwave',
  provider_refund_id TEXT,
  transaction_id TEXT,
  tx_ref TEXT,
  flw_ref TEXT,
  user_id TEXT,
  amount_refunded REAL,
  currency TEXT,
  status TEXT NOT NULL, -- pending|completed|failed|unknown
  reason TEXT,
  raw_json TEXT,
  created_at_provider INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_refunds_provider_refund
  ON billing_refunds (provider, provider_refund_id) WHERE provider_refund_id IS NOT NULL AND provider_refund_id <> '';
CREATE INDEX IF NOT EXISTS idx_billing_refunds_txid
  ON billing_refunds (provider, transaction_id);
CREATE INDEX IF NOT EXISTS idx_billing_refunds_user_updated
  ON billing_refunds (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS billing_disputes (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'flutterwave',
  provider_dispute_id TEXT NOT NULL,
  transaction_id TEXT,
  tx_ref TEXT,
  flw_ref TEXT,
  user_id TEXT,
  amount REAL,
  currency TEXT,
  status TEXT NOT NULL, -- open|won|lost|resolved|pending|unknown
  stage TEXT,
  reason TEXT,
  evidence_due_at INTEGER,
  raw_json TEXT,
  created_at_provider INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_disputes_provider_id
  ON billing_disputes (provider, provider_dispute_id);
CREATE INDEX IF NOT EXISTS idx_billing_disputes_user_updated
  ON billing_disputes (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_disputes_status_updated
  ON billing_disputes (status, updated_at DESC);

-- Persist raw provider payload snapshots linked to billing events/objects for audit/debug.
CREATE TABLE IF NOT EXISTS billing_provider_records (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'flutterwave',
  record_type TEXT NOT NULL, -- transaction|refund|dispute|chargeback|webhook|verify|reconciliation
  provider_id TEXT,
  tx_ref TEXT,
  flw_ref TEXT,
  user_id TEXT,
  status TEXT,
  amount REAL,
  currency TEXT,
  payload_json TEXT NOT NULL,
  occurred_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_provider_records_type_created
  ON billing_provider_records (record_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_provider_records_txref
  ON billing_provider_records (tx_ref);
CREATE INDEX IF NOT EXISTS idx_billing_provider_records_provider_id
  ON billing_provider_records (provider, provider_id);
CREATE INDEX IF NOT EXISTS idx_billing_provider_records_user_created
  ON billing_provider_records (user_id, created_at DESC);
