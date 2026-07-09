-- 021_food_pass.sql
-- Food Pass: a prepaid balance for membership students. Food bills auto-deduct from it
-- instead of creating a separate payable bill; the balance can go negative, at which point
-- it needs to be topped up (settled) by the student.

CREATE TABLE food_passes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id),
  balance NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE food_passes ENABLE ROW LEVEL SECURITY;
-- No policies — access only via the edge function's service-role client.
