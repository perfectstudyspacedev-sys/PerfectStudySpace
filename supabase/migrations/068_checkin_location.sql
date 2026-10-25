-- 068_checkin_location.sql  (PSS-AI Phase 4: SP13 self check-in, I4/SP15 seat matching)
-- A printed QR poster at each branch carries the branch id and its check-in key; the student's
-- phone sends its location, and the server checks it is within 100 m of the branch (D9). Only the
-- distance and the accuracy are kept, never the coordinates. The owner reprints with a new key
-- (rotate_checkin_key), which stops old posters working.

ALTER TABLE branches ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS checkin_key TEXT;
ALTER TABLE branches DROP CONSTRAINT IF EXISTS branches_location_check;
ALTER TABLE branches ADD CONSTRAINT branches_location_check CHECK (
  (latitude IS NULL AND longitude IS NULL)
  OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
);

-- Every self check-in or check-out try, with its result. booking_id is set when a session was
-- opened (in) or closed (out).
CREATE TABLE IF NOT EXISTS checkin_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('in', 'out')),
  result TEXT NOT NULL CHECK (result IN ('ok', 'too_far', 'low_accuracy', 'no_location', 'bad_key', 'refused')),
  distance_m INT CHECK (distance_m IS NULL OR distance_m >= 0),
  accuracy_m INT CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  -- The refusal shown to the student (no personal data).
  detail TEXT CHECK (detail IS NULL OR char_length(detail) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checkin_records_student ON checkin_records (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkin_records_branch ON checkin_records (branch_id, created_at DESC);

-- The consent shown before the first location check (D9). A new version asks again.
CREATE TABLE IF NOT EXISTS checkin_consents (
  student_id UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- I4/SP15: what a desk offers (set by the owner) and what a student likes.
ALTER TABLE desks ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS seat_preferences (
  student_id UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  desk_ids UUID[] NOT NULL DEFAULT '{}' CHECK (cardinality(desk_ids) <= 3),
  tags TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 4),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE checkin_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkin_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE seat_preferences ENABLE ROW LEVEL SECURITY;
-- No policies: only the edge functions' service-role client reads or writes them.
