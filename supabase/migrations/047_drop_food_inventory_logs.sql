-- 047_drop_food_inventory_logs.sql
-- Reverts 044_food_inventory_logs.sql — Inventory Management now tracks its own
-- inventory_items (045/046), fully decoupled from food_items, so the food-items-keyed log
-- table it replaced is no longer used. IF EXISTS makes this safe whether or not 044 ever
-- actually ran on a given environment.
DROP TABLE IF EXISTS food_inventory_logs;
