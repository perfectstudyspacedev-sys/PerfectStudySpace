-- 043_drop_food_stock_logs.sql
-- Reverts 042_food_stock_logs.sql — the stock-history feature it supported (restock_food_item
-- logging, list_food_stock_history) was replaced with a simpler add/avail inventory model
-- that doesn't need a log table. IF EXISTS makes this safe whether or not 042 ever actually
-- ran on a given environment.
DROP TABLE IF EXISTS food_stock_logs;
