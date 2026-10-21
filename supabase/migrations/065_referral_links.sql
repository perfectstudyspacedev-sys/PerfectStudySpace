-- 065_referral_links.sql  (PSS-AI Phase 3: referral attribution, SP11)
-- A tracked link per channel (C10) and branch replaces the "How did you hear about us?" choice
-- for people who arrive through one. A student's own link (channel 'friend') records who referred
-- whom (SP11). Each sign-up or enquiry chat from a link is an attribution; the nightly job marks
-- those whose phone later got a membership.

CREATE TABLE IF NOT EXISTS referral_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9]{8}$'),
  channel TEXT NOT NULL CHECK (channel IN ('instagram', 'google', 'flex_banner', 'friend', 'whatsapp', 'other')),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  label TEXT CHECK (label IS NULL OR char_length(label) <= 80),
  referrer_student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One friend link per student.
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_links_referrer ON referral_links (referrer_student_id) WHERE referrer_student_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS referral_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id UUID NOT NULL REFERENCES referral_links(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  phone TEXT NOT NULL CHECK (phone ~ '^[0-9]{10}$'),
  kind TEXT NOT NULL CHECK (kind IN ('signup', 'enquiry')),
  converted_student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  -- SP11: the referrer's reward waits in the approval queue (grant_cashback).
  reward_approval_id UUID REFERENCES approvals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT referral_attributions_link_phone UNIQUE (link_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_referral_attributions_open ON referral_attributions (created_at) WHERE converted_student_id IS NULL;

ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS referral_link_id UUID REFERENCES referral_links(id) ON DELETE SET NULL;

-- Two channels from C10 that the old list did not have.
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_referral_source_check;
ALTER TABLE students ADD CONSTRAINT students_referral_source_check
  CHECK (referral_source IS NULL OR referral_source IN ('google_search', 'instagram', 'word_of_mouth', 'flex', 'ai_platform', 'whatsapp', 'other'));

ALTER TABLE referral_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_attributions ENABLE ROW LEVEL SECURITY;
-- No policies: only the edge functions' service-role client reads or writes them.
