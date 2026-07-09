-- Migration 004: Overtime tracking for member sessions

CREATE TABLE IF NOT EXISTS overtime_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id),
  student_id UUID REFERENCES students(id),
  membership_id UUID REFERENCES memberships(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  overtime_minutes INT NOT NULL DEFAULT 0,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_overtime_student ON overtime_sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_overtime_branch ON overtime_sessions(branch_id);
