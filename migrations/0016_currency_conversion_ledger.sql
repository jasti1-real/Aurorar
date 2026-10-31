-- Additive groundwork for a single internal UGX ledger.
-- This migration deliberately does not convert or alter any existing wallet,
-- transaction, product purchase, referral reward, or withdrawal request.
-- Rates must be explicitly configured and validated before payment code uses them.
CREATE TABLE IF NOT EXISTS currency_fx_rates (
  currency TEXT PRIMARY KEY CHECK (currency IN ('UGX','RWF','ZMW')),
  ugx_per_unit_micros INTEGER NOT NULL CHECK (ugx_per_unit_micros > 0),
  source TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  effective_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- One row per conversion attempt, linked to a payment transaction where available.
-- Amounts are integers in the smallest whole units used by the local payment market.
CREATE TABLE IF NOT EXISTS currency_conversions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  transaction_id TEXT REFERENCES transactions(id),
  direction TEXT NOT NULL CHECK (direction IN ('collection_to_ugx','ugx_to_payout')),
  source_currency TEXT NOT NULL CHECK (source_currency IN ('UGX','RWF','ZMW')),
  source_amount INTEGER NOT NULL CHECK (source_amount > 0),
  target_currency TEXT NOT NULL CHECK (target_currency IN ('UGX','RWF','ZMW')),
  target_amount INTEGER NOT NULL CHECK (target_amount > 0),
  rate_ugx_per_unit_micros INTEGER NOT NULL CHECK (rate_ugx_per_unit_micros > 0),
  rate_source TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'MarzPay',
  provider_reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','failed','reversed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  confirmed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_currency_conversions_provider_reference
ON currency_conversions(provider, provider_reference)
WHERE provider_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_currency_conversions_user_created
ON currency_conversions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_currency_conversions_transaction
ON currency_conversions(transaction_id);

-- Never automatically enable an FX rate. Provider settlement terms and the rate
-- source must be confirmed before any live conversion is allowed.
