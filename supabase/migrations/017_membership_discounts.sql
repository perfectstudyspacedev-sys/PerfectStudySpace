-- 017_membership_discounts.sql
-- Owner-only loyalty discount: lets the owner manually knock a % or a fixed ₹ amount
-- off a membership student's pending fee (e.g. rewarding a student who studies the
-- most hours/visits, as seen on the Top Students leaderboard). Kept as its own
-- audited table rather than a plain column so there's a history of who applied what,
-- when, and why (remarks) — separate from `transactions`, since no money actually
-- changes hands here (it just reduces what's owed).

CREATE TABLE membership_discounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id),
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value NUMERIC NOT NULL,
  discount_amount NUMERIC NOT NULL,
  remarks TEXT,
  applied_by_staff_id UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_membership_discounts_student ON membership_discounts(student_id);
CREATE INDEX idx_membership_discounts_membership ON membership_discounts(membership_id);

ALTER TABLE membership_discounts ENABLE ROW LEVEL SECURITY;
-- No policies — same as every other table here: all access goes through the
-- edge function's service-role client, never the anon/authenticated key directly.
