CREATE TABLE user_subscriptions (
  user_id      TEXT PRIMARY KEY,
  status       TEXT NOT NULL DEFAULT 'inactive'
               CHECK (status IN ('active', 'inactive', 'expired', 'cancelled')),
  product_id   TEXT,
  platform     TEXT CHECK (platform IN ('ios', 'android', 'web')),
  expires_at   INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE user_daily_usage (
  user_id          TEXT NOT NULL,
  day              TEXT NOT NULL,
  translate_count  INTEGER NOT NULL DEFAULT 0,
  transcribe_count INTEGER NOT NULL DEFAULT 0,
  speech_chars     INTEGER NOT NULL DEFAULT 0,
  stream_count     INTEGER NOT NULL DEFAULT 0,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE user_cooldowns (
  user_id         TEXT PRIMARY KEY,
  last_request_at INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE flutterwave_claims (
  flw_ref    TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  tx_ref     TEXT NOT NULL,
  amount     REAL,
  currency   TEXT,
  expires_at INTEGER NOT NULL,
  claimed_at INTEGER NOT NULL
);

CREATE INDEX idx_flw_claims_user
  ON flutterwave_claims (user_id, claimed_at DESC);

CREATE TABLE app_config (
  id                      INTEGER PRIMARY KEY CHECK (id = 1),
  revenuecat_enabled      INTEGER NOT NULL DEFAULT 1,
  flutterwave_enabled     INTEGER NOT NULL DEFAULT 0,
  default_provider        TEXT NOT NULL DEFAULT 'revenuecat'
                          CHECK (default_provider IN ('revenuecat', 'flutterwave')),
  base_price_usd          REAL NOT NULL DEFAULT 2.23,
  discount_percent        REAL NOT NULL DEFAULT 0,
  annual_discount_percent REAL NOT NULL DEFAULT 20,
  local_prices            TEXT NOT NULL DEFAULT '{}',
  updated_at              INTEGER NOT NULL
);

INSERT INTO app_config (id, updated_at) VALUES (1, 0);
