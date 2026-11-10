-- Account lifecycle controls for admin support/safety operations.
ALTER TABLE users ADD COLUMN disabled_at INTEGER;
ALTER TABLE users ADD COLUMN disabled_reason TEXT;
