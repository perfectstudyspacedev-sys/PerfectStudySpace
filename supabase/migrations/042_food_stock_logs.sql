-- 042_food_stock_logs.sql
-- One row per restock event, so "how long did the last batch last" can be answered by
-- comparing consecutive stocked_at timestamps for the same item, instead of only ever
-- knowing the current count with no history behind it.
CREATE TABLE food_stock_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_item_id UUID NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  quantity_added INT NOT NULL,
  stocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_staff_id UUID REFERENCES staff(id)
);

CREATE INDEX idx_food_stock_logs_item ON food_stock_logs(food_item_id, stocked_at);

-- Same posture as every other table here: RLS on, no policies — all access goes through
-- the edge function's service-role client, never directly from the browser.
ALTER TABLE food_stock_logs ENABLE ROW LEVEL SECURITY;
