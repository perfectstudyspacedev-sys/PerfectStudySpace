-- 008_menu_seed.sql  ·  Run this in Supabase SQL Editor
-- Seeds the standard tea/coffee menu items into every active branch

INSERT INTO food_items (branch_id, name, price)
SELECT b.id, item.name, item.price
FROM branches b
CROSS JOIN (VALUES ('Tea', 12), ('Lemon Tea', 10), ('Coffee', 15)) AS item(name, price)
WHERE b.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM food_items fi WHERE fi.branch_id = b.id AND fi.name = item.name
  );
