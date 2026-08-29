-- 045_inventory_items.sql
-- Inventory is a separate concept from the food menu — supplies/packets staff track and use
-- (e.g. "Tea Packets", "Sugar", "Milk"), not necessarily the same names as what's sold to
-- customers on the menu. Deliberately has no foreign key to food_items.
CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (branch, name) — "Add Inventory" upserts by name rather than creating
-- duplicate rows for the same item typed again.
CREATE UNIQUE INDEX idx_inventory_items_branch_name ON inventory_items(branch_id, lower(name));

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
