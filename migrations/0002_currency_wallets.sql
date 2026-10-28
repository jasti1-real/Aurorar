-- Multi-currency groundwork for Aurorar.
-- Existing wallets remain the UGX ledger. These rows are separate RWF/ZMW ledgers.
ALTER TABLE transactions ADD COLUMN currency TEXT NOT NULL DEFAULT 'UGX'
  CHECK (currency IN ('UGX', 'RWF', 'ZMW'));

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
