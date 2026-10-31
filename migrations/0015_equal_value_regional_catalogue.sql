-- Rebuild regional catalogue prices from the canonical UGX catalogue.
-- Fixed accounting FX rates: 1 RWF = 3.0375 UGX; 1 ZMW = 222.9901 UGX.
-- Local prices and daily income are rounded to the nearest whole local-currency unit.
-- This updates catalogue offers only; existing purchases, wallets, transactions, and
-- earning ledgers are intentionally untouched.
UPDATE regional_products
SET price = (
  SELECT CAST(ROUND(p.price_ugx / CASE regional_products.currency
    WHEN 'RWF' THEN 3.0375
    WHEN 'ZMW' THEN 222.9901
  END) AS INTEGER)
  FROM products p WHERE p.id = regional_products.id
),
daily_income = (
  SELECT CAST(ROUND(p.daily_income_ugx / CASE regional_products.currency
    WHEN 'RWF' THEN 3.0375
    WHEN 'ZMW' THEN 222.9901
  END) AS INTEGER)
  FROM products p WHERE p.id = regional_products.id
),
duration_days = (
  SELECT p.duration_days FROM products p WHERE p.id = regional_products.id
),
name = (
  SELECT p.name FROM products p WHERE p.id = regional_products.id
),
updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE currency IN ('RWF','ZMW')
  AND EXISTS (SELECT 1 FROM products p WHERE p.id = regional_products.id);

-- Ensure every active UGX machine has a corresponding local-currency catalogue row.
INSERT INTO regional_products (id, currency, name, price, daily_income, duration_days, active)
SELECT p.id, c.currency, p.name,
  CAST(ROUND(p.price_ugx / CASE c.currency
    WHEN 'RWF' THEN 3.0375
    WHEN 'ZMW' THEN 222.9901
  END) AS INTEGER),
  CAST(ROUND(p.daily_income_ugx / CASE c.currency
    WHEN 'RWF' THEN 3.0375
    WHEN 'ZMW' THEN 222.9901
  END) AS INTEGER),
  p.duration_days, p.active
FROM products p
CROSS JOIN (SELECT 'RWF' AS currency UNION ALL SELECT 'ZMW') c
WHERE NOT EXISTS (
  SELECT 1 FROM regional_products rp
  WHERE rp.id = p.id AND rp.currency = c.currency
);
