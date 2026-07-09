-- 015_enquiries_rls.sql — Lock down enquiries tables like every other table.
-- These were created without RLS in 014_enquiries.sql; the anon key ships in the
-- client bundle, so without RLS anyone holding it could read/write these tables
-- directly via the Supabase REST API, bypassing the `api` edge function entirely.
-- Enabling RLS with no policies denies all anon/authenticated access by default,
-- matching the rest of the schema — all real access continues to go through the
-- edge function's service-role client, which is unaffected by RLS.

ALTER TABLE enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE enquiry_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE enquiry_followups ENABLE ROW LEVEL SECURITY;
