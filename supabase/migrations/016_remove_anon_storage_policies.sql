-- 016_remove_anon_storage_policies.sql  ·  Run this in Supabase SQL Editor
-- Removes the anon INSERT/UPDATE policies added in 010_storage_anon_upload.sql.
-- Those policies let ANYONE with the public anon key (bundled in the frontend JS,
-- extractable by any visitor) upload or overwrite files in the public `student-photos`
-- bucket — including overwriting other students' Aadhaar/ID photos — with no staff
-- authentication at all.
--
-- Uploads now go through the edge function's `get_upload_url` action, which requires a
-- valid staff JWT and issues a short-lived signed upload URL (service-role generated,
-- bypasses RLS by design) instead of relying on a blanket anon policy.

DROP POLICY IF EXISTS "anon_upload_photos" ON storage.objects;
DROP POLICY IF EXISTS "anon_update_photos" ON storage.objects;
