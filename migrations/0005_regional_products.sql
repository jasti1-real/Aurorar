-- Separate local-currency catalogue and purchase records. No regional prices are seeded:
-- the operator must configure verified RWF/ZMW prices before these products appear.
CREATE TABLE IF NOT EXISTS regional_products (
  id INTEGER NOT NULL CHECK (id BETWEEN 1 AND 10),
  currency TEXT NOT NULL CHECK (currency IN ('RWF','ZMW')),
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price > 0),
  daily_income INTEGER NOT NULL CHECK (daily_income >= 0),
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (id, currency)
);
CREATE TABLE IF NOT EXISTS regional_user_products (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('RWF','ZMW')),
  purchase_price INTEGER NOT NULL CHECK (purchase_price > 0),
  daily_income INTEGER NOT NULL DEFAULT 0 CHECK (daily_income >= 0),
  starts_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  purchased_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (product_id, currency) REFERENCES regional_products(id, currency)
);
CREATE INDEX IF NOT EXISTS idx_regional_user_products_user
ON regional_user_products(user_id, currency, status, purchased_at DESC);
