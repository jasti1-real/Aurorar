-- Aurorar product catalogue seed. Safe to run more than once.
INSERT OR IGNORE INTO products (id, name, price_ugx, daily_income_ugx, duration_days, active) VALUES
(1, 'Machine 1', 15000, 5000, 60, 1),
(2, 'Machine 2', 30000, 10000, 45, 1),
(3, 'Machine 3', 60000, 20000, 30, 1),
(4, 'Machine 4', 120000, 30000, 15, 1),
(5, 'Machine 5', 250000, 62500, 15, 1),
(6, 'Machine 6', 500000, 125000, 15, 1),
(7, 'Machine 7', 1000000, 250000, 10, 1),
(8, 'Machine 8', 1500000, 500000, 10, 1),
(9, 'Machine 9', 2000000, 750000, 10, 1),
(10, 'Machine 10', 1000000, 250000, 30, 1);
