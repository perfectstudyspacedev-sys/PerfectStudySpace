-- 033_overtime_excluded.sql
-- Lets staff omit a specific overtime session from billing entirely (a per-row "waive this"
-- checkbox on the student profile) without deleting the record — it stays visible for audit,
-- just excluded from the sums used at renewal/closure/delete-membership settlement.

ALTER TABLE overtime_sessions ADD COLUMN IF NOT EXISTS excluded BOOLEAN NOT NULL DEFAULT false;
