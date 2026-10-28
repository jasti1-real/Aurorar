-- Prepare regional earnings with immutable purchase-rate snapshots and an idempotent ledger.
-- This migration does not credit wallets, enable regional purchases, or start a scheduler.
ALTER TABLE regional_user_products
  ADD COLUMN daily_income INTEGER NOT NULL DEFAULT 0 CHECK (daily_income >= 0);

UPDATE regional_user_products
SET daily_income = COALESCE((
  SELECT rp.daily_income
  FROM regional_products rp
  WHERE rp.id = regional_user_products.product_id
    AND rp.currency = regional_user_products.currency
), 0);

CREATE TABLE IF NOT EXISTS regional_earning_ledger (
  id TEXT PRIMARY KEY,
  user_product_id TEXT NOT NULL REFERENCES regional_user_products(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency TEXT NOT NULL CHECK (currency IN ('RWF','ZMW')),
  earning_date TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','credited')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  credited_at TEXT,
  UNIQUE (user_product_id, earning_date)
);

CREATE INDEX IF NOT EXISTS idx_regional_earning_ledger_user_date
ON regional_earning_ledger(user_id, currency, earning_date DESC);
