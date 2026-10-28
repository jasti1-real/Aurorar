-- Multi-currency groundwork for Aurorar.
-- The transactions.currency column already exists in the remote database, so this
-- migration only ensures the regional wallet table and index exist.
-- Existing wallets remain the UGX ledger. These rows are separate RWF/ZMW ledgers.
CREATE TABLE IF NOT EXISTS currency_wallets (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency TEXT NOT NULL CHECK (currency IN ('RWF', 'ZMW')),
  available_balance INTEGER NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
  total_deposited INTEGER NOT NULL DEFAULT 0 CHECK (total_deposited >= 0),
  total_earned INTEGER NOT NULL DEFAULT 0 CHECK (total_earned >= 0),
  total_withdrawn INTEGER NOT NULL DEFAULT 0 CHECK (total_withdrawn >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, currency)
);

CREATE INDEX IF NOT EXISTS idx_transactions_currency_status
ON transactions(currency, status, created_at DESC);
