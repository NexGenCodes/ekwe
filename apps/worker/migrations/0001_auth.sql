-- Auth core. All timestamps are epoch milliseconds.
CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL,
  email_norm     TEXT NOT NULL UNIQUE,
  tier           TEXT NOT NULL DEFAULT 'FREE'
                 CHECK (tier IN ('FREE', 'PREMIUM')),
  pro_expires_at INTEGER,
  display_name   TEXT,
  avatar_url     TEXT,
  avatar_icon    TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE INDEX idx_users_expiry ON users (pro_expires_at)
  WHERE pro_expires_at IS NOT NULL;

CREATE TABLE identities (
  provider         TEXT NOT NULL
                   CHECK (provider IN ('email', 'apple', 'google')),
  provider_user_id TEXT NOT NULL,
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email            TEXT,
  created_at       INTEGER NOT NULL,
  last_used_at     INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);

CREATE INDEX idx_identities_user ON identities (user_id);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  revoked_at   INTEGER,
  user_agent   TEXT
);

CREATE INDEX idx_sessions_user ON sessions (user_id);

-- Every issued refresh hash is kept so reuse is detectable.
CREATE TABLE session_rotations (
  refresh_hash TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  issued_at    INTEGER NOT NULL,
  replaced_by  TEXT,
  used_at      INTEGER
);

CREATE INDEX idx_session_rotations_session
  ON session_rotations (session_id);

CREATE TABLE otp_codes (
  email_norm   TEXT PRIMARY KEY,
  code_hash    TEXT NOT NULL,
  expires_at   INTEGER NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_sent_at INTEGER NOT NULL
);
