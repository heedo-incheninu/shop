CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
ALTER TABLE orders ADD COLUMN payment_key TEXT;
ALTER TABLE orders ADD COLUMN paid_at TEXT;
