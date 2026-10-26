-- 070_deprecate_staff_ops.sql  (PSS-AI Phase 5, S1 / C18)
-- The desk-staff modules retire once they have sat unused for a month (the owner checks the usage
-- report, then switches pssai_retire_staff_ops on). Nothing is dropped here: the tables and columns
-- are only marked, and a later migration removes them after the data is archived (R2).
COMMENT ON TABLE staff_attendance IS 'DEPRECATED (PSS-AI S1, 2026-10-25): desk-staff attendance. Not written while pssai_retire_staff_ops is on; drop only after archiving.';
COMMENT ON COLUMN staff.override_branch_id IS 'DEPRECATED (PSS-AI S1): same-day branch override for desk staff.';
COMMENT ON COLUMN staff.override_date IS 'DEPRECATED (PSS-AI S1): same-day branch override for desk staff.';

-- C18 keeps owner, admin, kitchen and housekeeping accounts: a staff account's duty tells them apart.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS duty TEXT NOT NULL DEFAULT 'desk';
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_duty_check;
ALTER TABLE staff ADD CONSTRAINT staff_duty_check CHECK (duty IN ('desk', 'kitchen', 'housekeeping'));
