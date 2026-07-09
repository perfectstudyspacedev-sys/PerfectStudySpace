-- 023_payouts.sql
-- Ledger of money handed back to students (cashback payouts, locker deposit refunds,
-- unused Food Pass balance refunds) — none of these are recorded in `transactions` since
-- they're not incoming revenue, but Revenue reporting needs to net them against collections
-- to show the actual final revenue after everything surrendered back to students.

CREATE TABLE payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  branch_id UUID NOT NULL REFERENCES branches(id),
  payout_type TEXT NOT NULL CHECK (payout_type IN ('cashback', 'locker_deposit', 'food_pass_refund')),
  amount NUMERIC(10,2) NOT NULL,
  notes TEXT,
  created_by_staff_id UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payouts_branch_date ON payouts(branch_id, created_at);

ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
-- No policies — access only via the edge function's service-role client.
