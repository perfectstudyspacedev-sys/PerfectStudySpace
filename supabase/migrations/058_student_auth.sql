-- 058_student_auth.sql  (PSS-AI P2.1, SP1)
-- Student portal login: a 6-digit PIN per student (D6), one-time setup codes sent by the desk,
-- and login sessions. PINs and setup codes are stored only as PBKDF2 hashes with a per-row salt
-- (supabase/functions/_shared/student.ts); nothing here holds a PIN or a code in clear.
-- Additions only.

CREATE TABLE IF NOT EXISTS student_credentials (
  student_id UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  failed_attempts INT NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TIMESTAMPTZ,
  pin_set_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- When the student accepted the portal privacy notice (shown before the PIN is set).
  privacy_accepted_at TIMESTAMPTZ
);

-- One live code per student; a new code replaces the old one. Wrong tries count against it.
CREATE TABLE IF NOT EXISTS student_setup_codes (
  student_id UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_student_sessions_student ON student_sessions (student_id, created_at DESC);

ALTER TABLE student_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_setup_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_sessions ENABLE ROW LEVEL SECURITY;
-- No policies: only the edge functions' service-role client reads or writes them.
