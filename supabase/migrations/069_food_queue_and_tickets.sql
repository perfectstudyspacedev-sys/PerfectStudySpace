-- 069_food_queue_and_tickets.sql  (PSS-AI Phase 4: I20/I21 food, SP16 ordering, I22/SP17 tickets,
-- photo-proof housekeeping tasks)
-- Food (D10): students order in the portal; anyone working the queue (a kitchen person, an outside
-- vendor's staff login, the owner restocking vending) accepts, readies and delivers. The bill is
-- made at delivery by the existing create_food_bill, so how food is paid does not change.

CREATE TABLE IF NOT EXISTS food_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  -- [{ foodItemId, name, price, quantity }] as shown to the student; total worked out by the server.
  items JSONB NOT NULL,
  total NUMERIC(10,2) NOT NULL CHECK (total >= 0),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 200),
  status TEXT NOT NULL DEFAULT 'placed' CHECK (status IN ('placed', 'accepted', 'ready', 'delivered', 'cancelled')),
  food_bill_id UUID REFERENCES food_bills(id) ON DELETE SET NULL,
  cancel_reason TEXT CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 200),
  handled_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_food_orders_queue ON food_orders (branch_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_food_orders_student ON food_orders (student_id, created_at DESC);

-- I20: a menu item can use packets of an inventory item; billing it takes them off (pssai_food_stock).
ALTER TABLE food_items ADD COLUMN IF NOT EXISTS inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL;
ALTER TABLE food_items ADD COLUMN IF NOT EXISTS inventory_per_unit INT NOT NULL DEFAULT 1 CHECK (inventory_per_unit BETWEEN 1 AND 100);
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS supplier_phone TEXT CHECK (supplier_phone IS NULL OR supplier_phone ~ '^[0-9]{10}$');
ALTER TABLE inventory_logs DROP CONSTRAINT IF EXISTS inventory_logs_action_check;
ALTER TABLE inventory_logs ADD CONSTRAINT inventory_logs_action_check CHECK (action IN ('add', 'avail', 'sold'));

-- I21: supplier orders drafted from the demand forecast, for the owner to send or discard.
CREATE TABLE IF NOT EXISTS supplier_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  -- [{ inventoryItemId, name, have, need, order, supplierPhone }]
  items JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'received', 'discarded')),
  decided_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One open draft per branch: the nightly job refreshes it rather than adding another.
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_orders_draft ON supplier_orders (branch_id) WHERE status = 'draft';

-- I22/SP17: a problem reported in the portal (C16 categories), worked by staff.
CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('cleanliness', 'noise', 'wifi', 'seat', 'food', 'other')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
  details TEXT NOT NULL CHECK (char_length(details) BETWEEN 3 AND 600),
  desk_label TEXT CHECK (desk_label IS NULL OR char_length(desk_label) <= 20),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  resolution TEXT CHECK (resolution IS NULL OR char_length(resolution) <= 300),
  handled_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tickets_queue ON tickets (branch_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_student ON tickets (student_id, created_at DESC);

-- C17: housekeeping tasks confirmed with a photo, one per task per day.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS needs_photo BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS task_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  completion_date DATE NOT NULL,
  photo_path TEXT NOT NULL,
  uploaded_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, completion_date)
);
CREATE INDEX IF NOT EXISTS idx_task_photos_created ON task_photos (created_at);

ALTER TABLE food_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_photos ENABLE ROW LEVEL SECURITY;
-- No policies: only the edge functions' service-role client reads or writes them.

-- Task photos: a private bucket; the owner sees them through short-lived signed links.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('task-photos', 'task-photos', false, 1572864, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
