-- Lets the owner temporarily reassign a staff member to a different branch for a single
-- day (e.g. covering an absence) without changing their permanent home branch. The override
-- only applies for `override_date` — once that date passes it's simply ignored, no cleanup
-- job needed.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS override_branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS override_date DATE;
