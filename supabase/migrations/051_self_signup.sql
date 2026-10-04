-- 051_self_signup.sql
-- SSP (Self Sign-up Plan): each branch gets an unlisted link (/join/<signup_code>) where a new
-- student types their own details. Those details wait in signup_requests until staff Approve
-- (New Registration opens pre-filled) and Register, or Deny. Nothing reaches `students` or
-- `memberships` until staff press Register. Pending rows are deleted when handled, when denied,
-- and automatically after the end of the IST day they were submitted on (lazy purge in the
-- edge function). Additions only.

-- The secret part of each branch's link. Null until the owner first opens/copies the link;
-- "Make new link" replaces it, which makes the old link stop working at once.
ALTER TABLE branches ADD COLUMN IF NOT EXISTS signup_code TEXT UNIQUE;

CREATE TABLE IF NOT EXISTS signup_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  -- Short code shown to the student ("Ref #7F3A") so the desk can find their entry.
  ref_code TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  phone TEXT NOT NULL CHECK (phone ~ '^[0-9]{10}$'),
  emergency_contact TEXT NOT NULL CHECK (emergency_contact ~ '^[0-9]{10}$'),
  course TEXT CHECK (course IS NULL OR char_length(course) <= 80),
  referral_source TEXT NOT NULL,
  -- "Being handled by …": set when a staff member presses Approve; a claim older than
  -- 15 minutes is treated as released (enforced in the edge function).
  claimed_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One pending sign-up per phone per branch: a resubmission updates the existing row.
  CONSTRAINT signup_requests_branch_phone_key UNIQUE (branch_id, phone),
  CONSTRAINT signup_requests_branch_ref_key UNIQUE (branch_id, ref_code)
);

CREATE INDEX IF NOT EXISTS idx_signup_requests_branch_created ON signup_requests(branch_id, created_at);

ALTER TABLE signup_requests ENABLE ROW LEVEL SECURITY;
-- No policies — same as every other table here: the public page can only reach this table
-- through the edge function's submit action (service-role client), never directly.
