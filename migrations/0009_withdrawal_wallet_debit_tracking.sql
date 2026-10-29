-- Track whether a payout request has already debited/refunded its wallet.
-- This makes provider callbacks idempotent and prevents double refunds.
ALTER TABLE withdrawal_requests ADD COLUMN wallet_debited_at TEXT;
ALTER TABLE withdrawal_requests ADD COLUMN wallet_refunded_at TEXT;
