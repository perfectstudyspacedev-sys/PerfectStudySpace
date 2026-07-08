-- 019_cashbacks.sql
-- Cashback rewards for students who study the most hours in a month. Staff/owner manually
-- grant one after checking the Top Students leaderboard. It sits as a pending credit and is
-- consumed either at the student's next membership renewal (as a discount on the renewal fee)
-- or, if they close their membership instead of renewing, paid out in cash at closure.

CREATE TABLE cashbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id),
  month_label TEXT NOT NULL,
  cashback_type TEXT NOT NULL CHECK (cashback_type IN ('percent', 'fixed')),
  cashback_value NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'redeemed', 'settled')),
  redeemed_membership_id UUID REFERENCES memberships(id) ON DELETE SET NULL,
  redeemed_amount NUMERIC,
  redeemed_at TIMESTAMPTZ,
  notes TEXT,
  granted_by_staff_id UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cashbacks_student ON cashbacks(student_id);
CREATE INDEX idx_cashbacks_student_pending ON cashbacks(student_id, status);

ALTER TABLE cashbacks ENABLE ROW LEVEL SECURITY;
-- No policies — access only via the edge function's service-role client, same as every
-- other table in this schema.
