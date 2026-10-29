-- Track the one-time welcome bonus credit so it cannot be applied twice.
ALTER TABLE users ADD COLUMN welcome_bonus_credited_at TEXT;

-- Backfill only untouched regional accounts. Accounts with any transaction or machine
-- purchase are left for reconciliation rather than risking a duplicate credit.
UPDATE currency_wallets
SET available_balance = available_balance + CASE currency WHEN 'RWF' THEN 1646 WHEN 'ZMW' THEN 22 ELSE 0 END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE currency IN ('RWF','ZMW')
  AND available_balance = 0
  AND total_deposited = 0
  AND total_earned = 0
  AND total_withdrawn = 0
  AND referral_earnings = 0
  AND EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = currency_wallets.user_id
      AND u.country = CASE currency_wallets.currency WHEN 'RWF' THEN 'RW' ELSE 'ZM' END
      AND u.welcome_bonus = 5000
      AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM regional_user_products p WHERE p.user_id = u.id)
  );

UPDATE users
SET welcome_bonus_credited_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE country IN ('RW','ZM')
  AND welcome_bonus = 5000
  AND welcome_bonus_credited_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = users.id)
  AND NOT EXISTS (SELECT 1 FROM regional_user_products p WHERE p.user_id = users.id);
