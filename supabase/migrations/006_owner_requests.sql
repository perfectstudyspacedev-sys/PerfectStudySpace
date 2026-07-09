-- 006_owner_requests.sql  ·  Run this in Supabase SQL Editor
-- Adds: locker capacity per branch, emergency contact + referral source on students,
--       membership hold history table, new 13h/15h permanent packages

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Locker capacity per branch
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE branches ADD COLUMN IF NOT EXISTS locker_capacity INT NOT NULL DEFAULT 0;

UPDATE branches SET locker_capacity = 18 WHERE name = 'Ram Nagar';
UPDATE branches SET locker_capacity = 20 WHERE name = '100 Feet Road';
UPDATE branches SET locker_capacity = 45 WHERE name = 'Hopes';

-- Allow a locker number to be reused once the previous holder's locker is removed
ALTER TABLE lockers DROP CONSTRAINT IF EXISTS lockers_branch_id_locker_no_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_lockers_branch_locker_active
  ON lockers(branch_id, locker_no) WHERE is_active = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Student registration fields — emergency contact + referral source
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE students ADD COLUMN IF NOT EXISTS emergency_contact TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS referral_source TEXT
  CHECK (referral_source IS NULL OR referral_source IN ('google_search', 'instagram', 'word_of_mouth', 'flex'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Membership hold history — one row per hold/resume cycle
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS membership_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  paused_at TIMESTAMPTZ NOT NULL,
  resumed_at TIMESTAMPTZ,
  days_paused INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_membership_holds_membership ON membership_holds(membership_id);
CREATE INDEX IF NOT EXISTS idx_membership_holds_student ON membership_holds(student_id);

ALTER TABLE membership_holds ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. New permanent packages — 13 hrs/day (₹2200) and 15 hrs/day (₹2400)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO fee_config (config_type, hours_per_day, fee, cabin_type, sort_order)
SELECT 'membership', 13, 2200, 'permanent', 10
WHERE NOT EXISTS (
  SELECT 1 FROM fee_config WHERE config_type = 'membership' AND cabin_type = 'permanent' AND hours_per_day = 13
);

INSERT INTO fee_config (config_type, hours_per_day, fee, cabin_type, sort_order)
SELECT 'membership', 15, 2400, 'permanent', 11
WHERE NOT EXISTS (
  SELECT 1 FROM fee_config WHERE config_type = 'membership' AND cabin_type = 'permanent' AND hours_per_day = 15
);
