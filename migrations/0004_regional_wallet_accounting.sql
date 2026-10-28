-- The referral_earnings column is included in the base regional-wallet migration for new databases.
-- Production already has this column, so this historical migration is intentionally a no-op
-- to allow D1 migration history to catch up without attempting a duplicate ALTER TABLE.
SELECT 1;
