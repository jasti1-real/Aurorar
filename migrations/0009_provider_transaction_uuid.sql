ALTER TABLE transactions ADD COLUMN provider_transaction_uuid TEXT;
CREATE INDEX IF NOT EXISTS idx_transactions_provider_uuid ON transactions(provider_transaction_uuid);