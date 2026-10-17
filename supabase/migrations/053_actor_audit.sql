-- 053_actor_audit.sql  (PSS-AI P0.5, F2)
-- Who did it, on the tables that already record created_by_staff_id. Nullable and not
-- backfilled: NULL means the row is from before this plan. actor_type is the caller type
-- (staff, owner, admin today; agent, student, system later), actor_id the staff/student id,
-- run_id the agent run that made it (Phase 1+).

ALTER TABLE bookings           ADD COLUMN IF NOT EXISTS actor_type TEXT, ADD COLUMN IF NOT EXISTS actor_id UUID, ADD COLUMN IF NOT EXISTS run_id UUID;
ALTER TABLE food_bills         ADD COLUMN IF NOT EXISTS actor_type TEXT, ADD COLUMN IF NOT EXISTS actor_id UUID, ADD COLUMN IF NOT EXISTS run_id UUID;
ALTER TABLE memberships        ADD COLUMN IF NOT EXISTS actor_type TEXT, ADD COLUMN IF NOT EXISTS actor_id UUID, ADD COLUMN IF NOT EXISTS run_id UUID;
ALTER TABLE transactions       ADD COLUMN IF NOT EXISTS actor_type TEXT, ADD COLUMN IF NOT EXISTS actor_id UUID, ADD COLUMN IF NOT EXISTS run_id UUID;
ALTER TABLE enquiries          ADD COLUMN IF NOT EXISTS actor_type TEXT, ADD COLUMN IF NOT EXISTS actor_id UUID, ADD COLUMN IF NOT EXISTS run_id UUID;
ALTER TABLE permanent_waitlist ADD COLUMN IF NOT EXISTS actor_type TEXT, ADD COLUMN IF NOT EXISTS actor_id UUID, ADD COLUMN IF NOT EXISTS run_id UUID;
ALTER TABLE payouts            ADD COLUMN IF NOT EXISTS actor_type TEXT, ADD COLUMN IF NOT EXISTS actor_id UUID, ADD COLUMN IF NOT EXISTS run_id UUID;
ALTER TABLE inventory_logs     ADD COLUMN IF NOT EXISTS actor_type TEXT, ADD COLUMN IF NOT EXISTS actor_id UUID, ADD COLUMN IF NOT EXISTS run_id UUID;
ALTER TABLE waivers            ADD COLUMN IF NOT EXISTS actor_type TEXT, ADD COLUMN IF NOT EXISTS actor_id UUID, ADD COLUMN IF NOT EXISTS run_id UUID;
