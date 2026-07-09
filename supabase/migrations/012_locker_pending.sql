-- 012_locker_pending.sql  ·  Run this in Supabase SQL Editor
-- Tracks pay-now vs pay-later on lockers, so membership closure can check for
-- any pending locker dues in addition to pending membership fees.

ALTER TABLE lockers ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE lockers ADD COLUMN IF NOT EXISTS fee_due NUMERIC(10,2) NOT NULL DEFAULT 0;
