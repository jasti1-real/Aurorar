-- Explicit amount fields for the UGX-ledger migration.
-- Historical transactions.amount_ugx is retained unchanged because older Rwanda
-- and Zambia rows may contain local-currency values despite the legacy column name.
-- Backfill is intentionally omitted: historical currency semantics must be audited
-- per transaction before any automated conversion is safe.
ALTER TABLE transactions ADD COLUMN local_amount INTEGER;
ALTER TABLE transactions ADD COLUMN local_currency TEXT;
ALTER TABLE transactions ADD COLUMN ledger_amount_ugx INTEGER;

CREATE INDEX IF NOT EXISTS idx_transactions_local_currency_status
ON transactions(local_currency, status, created_at DESC);

-- Existing rows remain NULL in the new fields until reviewed and reconciled.
-- New payment code must populate all three fields consistently:
-- local_amount = amount requested/paid in the market currency;
-- local_currency = UGX, RWF, or ZMW;
-- ledger_amount_ugx = amount credited/debited in the internal UGX ledger.
