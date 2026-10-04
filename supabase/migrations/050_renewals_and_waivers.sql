-- 050_renewals_and_waivers.sql
-- RSP (docs/plans/RSP-renew-settle-and-self-signup.md) — additions only, nothing existing is
-- changed or removed.
--
-- 1. Renewal link + the plan's own price and length, stored at purchase.
--    renewed_from_membership_id: the membership a renewal continued. Cancel Early Renewal uses it
--      to restore exactly that membership instead of guessing by dates.
--    plan_amount: price after the multi-month discount, before cashback/overtime. total_paid can't
--      stand in for it — a renewal's payment also includes settled overtime and is net of cashback.
--    plan_days: days the plan covers (custom day count, or the start→end span). Together these give
--      the exact per-day rate for the Delete refund; neither could be reconstructed later for
--      custom-day plans. Rows created before this migration leave them NULL and the app falls
--      back to its best estimate from monthly_fee / months_paid / discount_percent.
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS renewed_from_membership_id UUID REFERENCES memberships(id) ON DELETE SET NULL;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS plan_amount NUMERIC(10,2);
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS plan_days INT;

-- 2. Cancel Early Renewal is logged to membership_edits with a required reason, the same audit
--    trail Delete Membership already uses.
ALTER TABLE membership_edits DROP CONSTRAINT IF EXISTS membership_edits_edit_type_check;
ALTER TABLE membership_edits ADD CONSTRAINT membership_edits_edit_type_check
  CHECK (edit_type IN ('cabin', 'end_date', 'attendance', 'delete_membership', 'cancel_early_renewal'));

-- 3. Waivers log (W2): who forgave how much, and why. Overstay waived at Quit/Delete, and
--    overtime omitted from billing (or put back) on the student profile — the two waivers that
--    previously left no record at all. Append-only: the app never updates or deletes a row.
CREATE TABLE IF NOT EXISTS waivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id),
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  membership_id UUID REFERENCES memberships(id) ON DELETE SET NULL,
  waiver_type TEXT NOT NULL CHECK (waiver_type IN ('overstay', 'overtime_omit', 'overtime_restore')),
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  related_id UUID,
  created_by_staff_id UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waivers_branch_date ON waivers(branch_id, created_at);

-- Same as every other table: RLS on with no policies, so the only way in is the edge
-- function's service-role client.
ALTER TABLE waivers ENABLE ROW LEVEL SECURITY;
