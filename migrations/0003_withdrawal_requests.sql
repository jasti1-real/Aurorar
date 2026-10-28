-- Withdrawal request workflow only: this records requests for review and never sends a payout.
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency TEXT NOT NULL CHECK (currency IN ('UGX','RWF','ZMW')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  phone_number TEXT NOT NULL,
  country TEXT NOT NULL CHECK (country IN ('UG','RW','ZM')),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','processing','completed','rejected','failed')),
  provider_reference TEXT UNIQUE,
  idempotency_key TEXT NOT NULL,
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status_created
ON withdrawal_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user_created
ON withdrawal_requests(user_id, created_at DESC);
