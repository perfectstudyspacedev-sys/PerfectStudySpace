-- 062_student_requests.sql  (PSS-AI P2.1 SP6/SP8, P2.4 A3, P2.5)
-- Requests a student makes in the portal that need the owner: holds outside the self-hold
-- policy (C1, D5), plan changes, refunds, privacy requests and waitlist acceptances. Each one is
-- linked to its approvals row. Also: planned resume dates for self-holds, waitlist offers (C2),
-- and what A3 onboarding keeps on a sign-up while its payment waits for the owner.

CREATE TABLE IF NOT EXISTS student_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('hold', 'plan_change', 'refund', 'privacy_download', 'privacy_delete', 'waitlist_accept')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  approval_id UUID REFERENCES approvals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_student_requests_student ON student_requests (student_id, created_at DESC);

-- Self-holds (C1): the day the hold ends by itself, and who asked for it.
ALTER TABLE membership_holds ADD COLUMN IF NOT EXISTS planned_resume_date DATE;
ALTER TABLE membership_holds ADD COLUMN IF NOT EXISTS requested_by_student BOOLEAN NOT NULL DEFAULT false;

-- Waitlist offers (C2): the waiting person's portal account, and the offer's 24-hour window.
ALTER TABLE permanent_waitlist ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students(id) ON DELETE SET NULL;
ALTER TABLE permanent_waitlist ADD COLUMN IF NOT EXISTS offered_at TIMESTAMPTZ;
ALTER TABLE permanent_waitlist ADD COLUMN IF NOT EXISTS offer_expires_at TIMESTAMPTZ;
ALTER TABLE permanent_waitlist ADD COLUMN IF NOT EXISTS offer_status TEXT
  CHECK (offer_status IS NULL OR offer_status IN ('offered', 'accepted', 'declined', 'expired'));

-- A3 onboarding: the PIN chosen at sign-up (hash only), how long a sign-up with a payment
-- waiting for the owner is kept (the nightly clean-up skips it until then), and the optional ID
-- photo with the AI's readable/name check (C3: never an ID number).
ALTER TABLE signup_requests ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE signup_requests ADD COLUMN IF NOT EXISTS keep_until TIMESTAMPTZ;
ALTER TABLE signup_requests ADD COLUMN IF NOT EXISTS id_photo_path TEXT;
ALTER TABLE signup_requests ADD COLUMN IF NOT EXISTS id_check JSONB;

ALTER TABLE student_requests ENABLE ROW LEVEL SECURITY;
-- No policies: only the edge functions' service-role client reads or writes it.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('id-photos', 'id-photos', false, 1572864, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
