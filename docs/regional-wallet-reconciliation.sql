-- Aurorar regional wallet reconciliation (READ-ONLY)
-- Run against a snapshot/export first, or execute each SELECT in Cloudflare D1.
-- This file intentionally contains no UPDATE, INSERT, DELETE, or currency conversion.
-- Do not infer UGX amounts from display-only exchange rates.

-- 1) Regional transaction completeness by currency and status.
SELECT
  currency,
  status,
  type,
  COUNT(*) AS transaction_count,
  SUM(CASE WHEN local_amount IS NULL THEN 1 ELSE 0 END) AS missing_local_amount_count,
  SUM(CASE WHEN local_currency IS NULL THEN 1 ELSE 0 END) AS missing_local_currency_count,
  SUM(CASE WHEN ledger_amount_ugx IS NULL THEN 1 ELSE 0 END) AS missing_ugx_ledger_amount_count
FROM transactions
WHERE currency IN ('RWF', 'ZMW')
GROUP BY currency, status, type
ORDER BY currency, type, status;

-- 2) Compare recorded regional wallet totals. These are local currency units,
-- not UGX, and are not proof of externally settled customer funds.
SELECT
  currency,
  COUNT(*) AS wallet_count,
  COALESCE(SUM(available_balance), 0) AS available_balance_local,
  COALESCE(SUM(total_deposited), 0) AS total_deposited_local,
  COALESCE(SUM(total_earned), 0) AS total_earned_local,
  COALESCE(SUM(total_withdrawn), 0) AS total_withdrawn_local,
  COALESCE(SUM(referral_earnings), 0) AS referral_earnings_local
FROM currency_wallets
WHERE currency IN ('RWF', 'ZMW')
GROUP BY currency
ORDER BY currency;

-- 3) Transaction totals by type/status. The amount_ugx column is historically
-- used for the provider amount in some regional records, so do not treat it
-- as UGX for RWF/ZMW rows without verified source evidence.
SELECT
  currency,
  type,
  status,
  COUNT(*) AS transaction_count,
  COALESCE(SUM(amount_ugx), 0) AS legacy_amount_column_sum,
  COALESCE(SUM(local_amount), 0) AS local_amount_sum,
  COALESCE(SUM(ledger_amount_ugx), 0) AS verified_ugx_ledger_sum
FROM transactions
WHERE currency IN ('RWF', 'ZMW')
GROUP BY currency, type, status
ORDER BY currency, type, status;

-- 4) Check whether payment_events can be linked to regional transactions,
-- using counts only (no personal identifiers or webhook payloads).
SELECT
  t.currency,
  t.status,
  COUNT(*) AS transaction_count,
  SUM(CASE WHEN pe.transaction_id IS NOT NULL THEN 1 ELSE 0 END) AS with_payment_event_count
FROM transactions t
LEFT JOIN payment_events pe ON pe.transaction_id = t.id
WHERE t.currency IN ('RWF', 'ZMW')
GROUP BY t.currency, t.status
ORDER BY t.currency, t.status;

-- Required before any repair:
-- a) Match each completed deposit to a confirmed MarzPay provider transaction.
-- b) Establish the source and denomination of each existing wallet balance.
-- c) Obtain a provider-confirmed settlement/FX amount if converting to UGX.
-- d) Prepare a reviewed, idempotent migration with a backup and audit trail.
-- Never backfill using frontend display rates or guess from amount_ugx.
