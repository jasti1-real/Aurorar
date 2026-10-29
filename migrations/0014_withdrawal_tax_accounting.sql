-- Persist the gross withdrawal, withheld tax, and net provider payout for audit/reconciliation.
ALTER TABLE withdrawal_requests ADD COLUMN tax_amount INTEGER NOT NULL DEFAULT 0 CHECK (tax_amount >= 0);
ALTER TABLE withdrawal_requests ADD COLUMN net_amount INTEGER NOT NULL DEFAULT 0 CHECK (net_amount >= 0);
