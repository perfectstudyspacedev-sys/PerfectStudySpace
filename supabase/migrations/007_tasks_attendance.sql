-- 007_tasks_attendance.sql  ·  Run this in Supabase SQL Editor
-- Adds: staff attendance (auto-marked on first login of the day),
--       two-way task assignment between owner and staff

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Staff attendance — one row per staff member per calendar day
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  first_login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(staff_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_staff_attendance_staff ON staff_attendance(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_date ON staff_attendance(attendance_date);

ALTER TABLE staff_attendance ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tasks — two-way assignment between owner and staff (including self-assign)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  assigned_by_staff_id UUID NOT NULL REFERENCES staff(id),
  assigned_to_staff_id UUID NOT NULL REFERENCES staff(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done')),
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tasks_branch ON tasks(branch_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to_staff_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON tasks(assigned_by_staff_id);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
