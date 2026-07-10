-- Tracks mid-cycle plan changes (temp <-> permanent, hours/day change) on an active
-- membership, separate from a full renewal. Lets staff see, and closure summaries show,
-- every plan a student has been on during a single membership period.
CREATE TABLE membership_plan_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id),
  old_category TEXT NOT NULL,
  old_hours_per_day INT NOT NULL,
  old_monthly_fee NUMERIC NOT NULL,
  new_category TEXT NOT NULL,
  new_hours_per_day INT NOT NULL,
  new_monthly_fee NUMERIC NOT NULL,
  prorated_amount NUMERIC NOT NULL DEFAULT 0,
  changed_by_staff_id UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_plan_changes_membership ON membership_plan_changes(membership_id);
CREATE INDEX idx_plan_changes_student ON membership_plan_changes(student_id);

ALTER TABLE membership_plan_changes ENABLE ROW LEVEL SECURITY;
-- No policies — access only via the edge function's service-role client.
