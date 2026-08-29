-- 046_inventory_logs.sql
-- Activity log for inventory_items — every add and avail event, when it happened and who
-- did it. Mirrors food_inventory_logs from migration 044, but points at inventory_items
-- instead of food_items now that the two are fully decoupled.
CREATE TABLE inventory_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('add', 'avail')),
  quantity INT NOT NULL,
  created_by_staff_id UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inventory_logs_branch ON inventory_logs(branch_id, created_at);
CREATE INDEX idx_inventory_logs_item ON inventory_logs(inventory_item_id, created_at);

ALTER TABLE inventory_logs ENABLE ROW LEVEL SECURITY;
