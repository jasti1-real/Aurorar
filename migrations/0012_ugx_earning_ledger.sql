-- Idempotent daily earning ledger for Uganda (UGX) machine purchases.
CREATE TABLE IF NOT EXISTS ugx_earning_ledger (
  id TEXT PRIMARY KEY,
  user_product_id TEXT NOT NULL REFERENCES user_products(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  earning_date TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','credited')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  credited_at TEXT,
  UNIQUE (user_product_id, earning_date)
);
CREATE INDEX IF NOT EXISTS idx_ugx_earning_ledger_user_date
ON ugx_earning_ledger(user_id, earning_date DESC);
