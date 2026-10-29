-- Add the daily income snapshot required by regional earning processing.
-- Existing purchases inherit the daily income from their regional catalogue item.
ALTER TABLE regional_user_products
ADD COLUMN daily_income INTEGER NOT NULL DEFAULT 0 CHECK (daily_income >= 0);

UPDATE regional_user_products
SET daily_income = COALESCE(
  (SELECT rp.daily_income
   FROM regional_products rp
   WHERE rp.id = regional_user_products.product_id
     AND rp.currency = regional_user_products.currency),
  0
)
WHERE daily_income = 0;
