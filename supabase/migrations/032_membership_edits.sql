-- 032_membership_edits.sql
-- Logs ad-hoc manual edits to a membership that aren't a full plan change (cabin
-- reassignment, a manual end-date correction) — separate from membership_plan_changes
-- since those columns are specific to category/hours and NOT NULL. Feeds the Reports
-- page's Recent Activity tab so these edits are visible alongside everything else.
CREATE TABLE membership_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id),
  edit_type TEXT NOT NULL CHECK (edit_type IN ('cabin', 'end_date')),
  old_value TEXT,
  new_value TEXT,
  changed_by_staff_id UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_membership_edits_branch_date ON membership_edits(branch_id, created_at);
CREATE INDEX idx_membership_edits_membership ON membership_edits(membership_id);

ALTER TABLE membership_edits ENABLE ROW LEVEL SECURITY;
-- No policies — access only via the edge function's service-role client.
