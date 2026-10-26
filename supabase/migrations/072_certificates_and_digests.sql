-- 072_certificates_and_digests.sql  (PSS-AI Phase 6: I33 study certificates, I34 parent digest)

-- I33/SP22 (C21): a record of real study hours, signed (HMAC-SHA256 with the CERTIFICATE_SECRET
-- Supabase secret) over exactly what the public check page shows.
CREATE TABLE IF NOT EXISTS study_certificates (
  id TEXT PRIMARY KEY CHECK (id ~ '^[0-9a-z]{10}$'),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  hall_name TEXT NOT NULL,
  student_name TEXT NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  hours NUMERIC(8,2) NOT NULL CHECK (hours >= 0),
  days INT NOT NULL CHECK (days >= 0),
  signature TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT study_certificates_range CHECK (date_to >= date_from)
);
CREATE INDEX IF NOT EXISTS idx_study_certificates_student ON study_certificates (student_id, issued_at DESC);

-- I34/SP23 (C22): a read-only weekly summary link the student chooses to share and can revoke.
CREATE TABLE IF NOT EXISTS parent_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  last_viewed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_parent_links_live ON parent_links (student_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS parent_digests (
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  -- { days: [{ date, minutes }], daysAttended, minutes, focus, planEnds, hall }
  summary JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, week_start)
);

ALTER TABLE study_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_digests ENABLE ROW LEVEL SECURITY;
-- No policies: only the edge functions' service-role client reads or writes them.
