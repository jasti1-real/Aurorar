ALTER TABLE withdrawal_requests ADD COLUMN request_type TEXT NOT NULL DEFAULT 'standard' CHECK (request_type IN ('standard','welcome_bonus'));
CREATE INDEX IF NOT EXISTS idx_withdrawal_bonus_once ON withdrawal_requests(user_id, request_type, status);
