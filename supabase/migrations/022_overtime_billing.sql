-- 022_overtime_billing.sql
-- Tracks whether an overtime session has been billed yet, so membership closure can charge
-- for accumulated overtime exactly once instead of losing track of it or double-charging.

ALTER TABLE overtime_sessions ADD COLUMN IF NOT EXISTS billed_at TIMESTAMPTZ;
ALTER TABLE overtime_sessions ADD COLUMN IF NOT EXISTS billed_amount NUMERIC(10,2);

CREATE INDEX IF NOT EXISTS idx_overtime_student_unbilled ON overtime_sessions(student_id, billed_at);
