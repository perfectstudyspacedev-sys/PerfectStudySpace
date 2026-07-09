-- 018_enquiry_trial_session.sql
-- Adds a "Trial Session" stage to the enquiry funnel — some students opt for a
-- paid trial (up to 2 hours) before deciding whether to take a membership, sitting
-- between "contacted" and "converted".

ALTER TABLE enquiries DROP CONSTRAINT IF EXISTS enquiries_status_check;
ALTER TABLE enquiries ADD CONSTRAINT enquiries_status_check
  CHECK (status IN ('new', 'contacted', 'trial_session', 'converted', 'dropped'));
