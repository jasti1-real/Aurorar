-- Track provider-side payout state separately from the user's request state.
-- This migration does not enable payouts; the API remains locked until the full
-- send-money request and verified webhook settlement flow is deployed.
ALTER TABLE withdrawal_requests ADD COLUMN provider_transaction_uuid TEXT;
ALTER TABLE withdrawal_requests ADD COLUMN provider_status TEXT;
ALTER TABLE withdrawal_requests ADD COLUMN payout_submitted_at TEXT;
ALTER TABLE withdrawal_requests ADD COLUMN completed_at TEXT;
ALTER TABLE withdrawal_requests ADD COLUMN failure_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawal_provider_transaction_uuid
ON withdrawal_requests(provider_transaction_uuid)
WHERE provider_transaction_uuid IS NOT NULL;
