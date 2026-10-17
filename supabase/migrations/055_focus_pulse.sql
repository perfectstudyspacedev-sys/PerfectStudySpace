-- 055_focus_pulse.sql  (PSS-AI P1.1, I9)
-- An optional 1–5 "How focused was today?" rating, asked at a member's checkout. At most one per
-- booking (the primary key); Skip writes nothing. Walk-ins are never asked. Students rate from
-- the portal in Phase 2 (source 'portal').

CREATE TABLE IF NOT EXISTS focus_ratings (
  booking_id UUID PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  source TEXT NOT NULL DEFAULT 'desk' CHECK (source IN ('desk', 'portal')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_focus_ratings_student ON focus_ratings (student_id, created_at);

ALTER TABLE focus_ratings ENABLE ROW LEVEL SECURITY;
-- No policies: only the edge functions' service-role client reads or writes it.
