-- 044_food_inventory_logs.sql
-- Every inventory event — owner/admin adding packets, or staff availing one — logged with
-- when it happened and who did it. Replaces 042/043's restock-only log with one that covers
-- both directions of the new add/avail model.
CREATE TABLE food_inventory_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_item_id UUID NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('add', 'avail')),
  quantity INT NOT NULL,
  created_by_staff_id UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_food_inventory_logs_branch ON food_inventory_logs(branch_id, created_at);
CREATE INDEX idx_food_inventory_logs_item ON food_inventory_logs(food_item_id, created_at);

-- Same posture as every other table here: RLS on, no policies — all access goes through
-- the edge function's service-role client, never directly from the browser.
ALTER TABLE food_inventory_logs ENABLE ROW LEVEL SECURITY;
