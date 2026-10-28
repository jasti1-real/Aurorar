-- Regional catalogue prices estimated from UGX catalogue using URA reference rates dated 2026-10-28:
-- 1 RWF = 3.0375 UGX; 1 ZMW = 222.9901 UGX. Prices are fixed local values,
-- not live FX conversion. Operator should review before enabling real transactions.
INSERT INTO regional_products (id,currency,name,price,daily_income,duration_days,active)
VALUES
(1,'RWF','Machine 1',4900,1600,60,1),
(1,'ZMW','Machine 1',67,22,60,1),
(2,'RWF','Machine 2',9900,3300,45,1),
(2,'ZMW','Machine 2',135,45,45,1),
(3,'RWF','Machine 3',19800,6600,30,1),
(3,'ZMW','Machine 3',269,90,30,1),
(4,'RWF','Machine 4',39500,9900,15,1),
(4,'ZMW','Machine 4',538,135,15,1),
(5,'RWF','Machine 5',82300,20600,15,1),
(5,'ZMW','Machine 5',1121,280,15,1),
(6,'RWF','Machine 6',164600,41200,15,1),
(6,'ZMW','Machine 6',2242,561,15,1),
(7,'RWF','Machine 7',329200,82300,10,1),
(7,'ZMW','Machine 7',4485,1121,10,1),
(8,'RWF','Machine 8',493800,164600,10,1),
(8,'ZMW','Machine 8',6727,2242,10,1),
(9,'RWF','Machine 9',658400,246900,10,1),
(9,'ZMW','Machine 9',8969,3363,10,1),
(10,'RWF','Machine 10',329200,82300,30,1),
(10,'ZMW','Machine 10',4485,1121,30,1)
ON CONFLICT(id,currency) DO UPDATE SET
 name=excluded.name, price=excluded.price, daily_income=excluded.daily_income,
 duration_days=excluded.duration_days, active=excluded.active,
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
