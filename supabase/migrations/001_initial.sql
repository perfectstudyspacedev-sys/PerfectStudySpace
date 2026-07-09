-- Perfect Study Space — initial schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE staff_role AS ENUM ('owner', 'staff');
CREATE TYPE desk_status AS ENUM ('free', 'occupied', 'reserved');
CREATE TYPE seat_type AS ENUM ('fixed', 'floating');
CREATE TYPE booking_type AS ENUM ('walkin', 'temporary', 'permanent');
CREATE TYPE booking_status AS ENUM ('active', 'completed', 'cancelled');
CREATE TYPE membership_category AS ENUM ('temporary', 'permanent');
CREATE TYPE student_status AS ENUM ('active', 'pending', 'inactive');
CREATE TYPE payment_mode AS ENUM ('cash', 'upi', 'other');
CREATE TYPE transaction_category AS ENUM ('desk', 'food', 'membership', 'locker', 'fine');
CREATE TYPE alert_type AS ENUM ('expiry', 'payment_due', 'locker_due');
CREATE TYPE alert_status AS ENUM ('pending', 'resolved');
CREATE TYPE recipient_type AS ENUM ('student', 'staff');

-- Branches
CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  desk_count INT NOT NULL DEFAULT 0,
  shift_config JSONB NOT NULL DEFAULT '["morning","afternoon","evening","night"]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Staff (owner + branch-scoped staff)
CREATE TABLE staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role staff_role NOT NULL,
  display_name TEXT,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Students
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  s_no INT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  course TEXT,
  aadhaar_photo_url TEXT,
  photo_url TEXT,
  status student_status NOT NULL DEFAULT 'pending',
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  total_visits INT NOT NULL DEFAULT 0,
  total_hours_studied NUMERIC(10,2) NOT NULL DEFAULT 0,
  loyalty_tag TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_students_phone ON students(phone);
CREATE INDEX idx_students_branch ON students(branch_id);
CREATE INDEX idx_students_status ON students(status);

-- Desks / cabins
CREATE TABLE desks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  seat_type seat_type NOT NULL DEFAULT 'floating',
  status desk_status NOT NULL DEFAULT 'free',
  assigned_student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  current_booking_id UUID,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(branch_id, label)
);

CREATE INDEX idx_desks_branch ON desks(branch_id);

-- Fee configuration (owner-configurable)
CREATE TABLE fee_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_type TEXT NOT NULL CHECK (config_type IN ('walkin', 'membership')),
  hours_per_day INT,
  max_hours INT,
  fee NUMERIC(10,2) NOT NULL,
  cabin_type membership_category,
  sort_order INT NOT NULL DEFAULT 0
);

-- Memberships
CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  category membership_category NOT NULL,
  seat_type seat_type NOT NULL,
  desk_id UUID REFERENCES desks(id) ON DELETE SET NULL,
  cabin_no TEXT,
  month TEXT,
  hours_per_day INT NOT NULL,
  timings TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  due_date DATE NOT NULL,
  months_paid INT NOT NULL DEFAULT 1,
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  monthly_fee NUMERIC(10,2) NOT NULL,
  total_paid NUMERIC(10,2) NOT NULL DEFAULT 0,
  fee_due NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  payment_mode payment_mode,
  created_by_staff_id UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_memberships_student ON memberships(student_id);
CREATE INDEX idx_memberships_branch ON memberships(branch_id);
CREATE INDEX idx_memberships_due ON memberships(due_date);

-- Bookings (walk-in sessions + member check-ins)
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  desk_id UUID REFERENCES desks(id) ON DELETE SET NULL,
  membership_id UUID REFERENCES memberships(id) ON DELETE SET NULL,
  shift_name TEXT,
  booking_type booking_type NOT NULL,
  start_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_time TIMESTAMPTZ,
  hours NUMERIC(5,2),
  timings_slot TEXT,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  status booking_status NOT NULL DEFAULT 'active',
  payment_mode payment_mode,
  created_by_staff_id UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bookings_branch ON bookings(branch_id, status);
CREATE INDEX idx_bookings_student ON bookings(student_id);

ALTER TABLE desks ADD CONSTRAINT fk_desks_current_booking
  FOREIGN KEY (current_booking_id) REFERENCES bookings(id) ON DELETE SET NULL;

-- Lockers
CREATE TABLE lockers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  locker_no TEXT NOT NULL,
  monthly_fee NUMERIC(10,2) NOT NULL DEFAULT 100,
  locker_due_date DATE,
  deposit_amount NUMERIC(10,2) NOT NULL DEFAULT 100,
  deposit_returned BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(branch_id, locker_no)
);

-- Food items
CREATE TABLE food_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  quantity INT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Food bills
CREATE TABLE food_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  student_name TEXT,
  student_phone TEXT,
  subtotal NUMERIC(10,2) NOT NULL,
  discount_type TEXT,
  discount_value NUMERIC(10,2) DEFAULT 0,
  discount_amount NUMERIC(10,2) DEFAULT 0,
  total NUMERIC(10,2) NOT NULL,
  payment_mode payment_mode NOT NULL DEFAULT 'cash',
  created_by_staff_id UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE food_bill_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_bill_id UUID NOT NULL REFERENCES food_bills(id) ON DELETE CASCADE,
  food_item_id UUID REFERENCES food_items(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  quantity INT NOT NULL DEFAULT 1
);

-- Transactions ledger
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  membership_id UUID REFERENCES memberships(id) ON DELETE SET NULL,
  food_bill_id UUID REFERENCES food_bills(id) ON DELETE SET NULL,
  locker_id UUID REFERENCES lockers(id) ON DELETE SET NULL,
  category transaction_category NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  payment_mode payment_mode NOT NULL DEFAULT 'cash',
  notes TEXT,
  created_by_staff_id UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_branch_date ON transactions(branch_id, created_at);
CREATE INDEX idx_transactions_category ON transactions(category);

-- Alerts
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  alert_type alert_type NOT NULL,
  due_date DATE,
  message TEXT,
  status alert_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Messages
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  sender_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  recipient_type recipient_type NOT NULL,
  recipient_student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  recipient_staff_id UUID REFERENCES staff(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

-- Auth helpers
CREATE OR REPLACE FUNCTION hash_staff_password(plain_password TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN crypt(plain_password, gen_salt('bf'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION verify_staff_login(p_username TEXT, p_password TEXT)
RETURNS TABLE (
  id UUID,
  username TEXT,
  role staff_role,
  display_name TEXT,
  branch_id UUID,
  branch_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.username, s.role, s.display_name, s.branch_id, b.name
  FROM staff s
  LEFT JOIN branches b ON b.id = s.branch_id
  WHERE s.username = p_username
    AND s.is_active = true
    AND s.password_hash = crypt(p_password, s.password_hash);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS: block direct anon access
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE desks ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE lockers ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_bill_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_config ENABLE ROW LEVEL SECURITY;

-- Seed: 3 branches
INSERT INTO branches (name, desk_count, shift_config) VALUES
  ('Ram Nagar', 30, '["morning","afternoon","evening","night"]'),
  ('100 Feet Road', 25, '["morning","afternoon","evening"]'),
  ('Hopes', 20, '["morning","afternoon","evening","night"]');

-- Seed desks for each branch
DO $$
DECLARE
  b RECORD;
  i INT;
BEGIN
  FOR b IN SELECT id, desk_count FROM branches LOOP
    FOR i IN 1..b.desk_count LOOP
      INSERT INTO desks (branch_id, label, sort_order)
      VALUES (b.id, 'C' || i, i);
    END LOOP;
  END LOOP;
END $$;

-- Seed walk-in fee tiers
INSERT INTO fee_config (config_type, max_hours, fee, sort_order) VALUES
  ('walkin', 3, 35, 1),
  ('walkin', 6, 60, 2),
  ('walkin', 8, 80, 3),
  ('walkin', 12, 100, 4);

-- Seed membership packages
INSERT INTO fee_config (config_type, hours_per_day, fee, cabin_type, sort_order) VALUES
  ('membership', 2, 500, 'temporary', 1),
  ('membership', 3, 650, 'temporary', 2),
  ('membership', 4, 800, 'temporary', 3),
  ('membership', 5, 1000, 'temporary', 4),
  ('membership', 6, 1250, 'temporary', 5),
  ('membership', 8, 1500, 'temporary', 6),
  ('membership', 12, 2100, 'permanent', 7),
  ('membership', 14, 2300, 'permanent', 8),
  ('membership', 24, 2500, 'permanent', 9);

-- Seed owner account (username: owner, password: owner123)
INSERT INTO staff (username, password_hash, role, display_name)
VALUES ('owner', hash_staff_password('owner123'), 'owner', 'Owner');

-- Seed sample staff for Ram Nagar
INSERT INTO staff (username, password_hash, role, display_name, branch_id)
SELECT 'staff1', hash_staff_password('staff123'), 'staff', 'Ram Nagar Staff',
  (SELECT id FROM branches WHERE name = 'Ram Nagar' LIMIT 1);

-- Seed sample food items (all branches)
INSERT INTO food_items (branch_id, name, price, quantity)
SELECT b.id, fi.name, fi.price, fi.qty
FROM branches b
CROSS JOIN (VALUES
  ('Tea', 15, 100),
  ('Coffee', 25, 100),
  ('Samosa', 20, 50),
  ('Maggi', 40, 30),
  ('Water Bottle', 20, 100)
) AS fi(name, price, qty);
