-- Lets staff mark when they end their session for the day (separate from login, which is
-- auto-marked). The owner can then see both entry and end time per staff in the Staff page.
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS last_logout_at TIMESTAMPTZ;
