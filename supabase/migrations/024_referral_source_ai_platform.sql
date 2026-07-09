-- 024_referral_source_ai_platform.sql
-- The "ai_platform" referral source (Claude/ChatGPT/AI Platforms) was added to the
-- frontend and to create_membership's application-level validation, but the
-- students.referral_source CHECK constraint (from 006_owner_requests.sql) was never
-- updated to allow it — so selecting it in the UI failed with a 500 on insert.

ALTER TABLE students DROP CONSTRAINT IF EXISTS students_referral_source_check;
ALTER TABLE students ADD CONSTRAINT students_referral_source_check
  CHECK (referral_source IS NULL OR referral_source IN ('google_search', 'instagram', 'word_of_mouth', 'flex', 'ai_platform'));
