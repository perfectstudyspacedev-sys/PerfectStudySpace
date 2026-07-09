-- 003_session_pause.sql  ·  Run this in Supabase SQL Editor
-- Adds per-session pause/resume support to the bookings table

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Pause fields on bookings
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_paused        BOOLEAN   NOT NULL DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paused_at        TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS total_pause_minutes INT NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Index for fast today's-bookings queries
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bookings_branch_date
  ON bookings(branch_id, created_at);

CREATE INDEX IF NOT EXISTS idx_bookings_status
  ON bookings(branch_id, status);
