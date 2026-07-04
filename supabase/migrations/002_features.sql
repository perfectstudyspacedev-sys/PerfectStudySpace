-- 002_features.sql  ·  Run this in Supabase SQL Editor
-- Adds: hold/resume, attendance check-in, optional timings, storage bucket

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Make memberships.timings optional (we removed it from the sign-up form)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE memberships ALTER COLUMN timings DROP NOT NULL;
ALTER TABLE memberships ALTER COLUMN timings SET DEFAULT '';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Hold / Resume  —  pause fields on memberships
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS is_paused BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS paused_at  TIMESTAMPTZ;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS hold_days  INT NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Attendance — add an index for fast "already checked in today?" lookups
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bookings_student_date
  ON bookings(student_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Storage bucket for student photos
--    (Supabase doesn't create buckets via SQL migration, but the RLS policies
--     below will be applied once you create the bucket manually — see notes.)
-- ─────────────────────────────────────────────────────────────────────────────
-- Bucket name: student-photos  (create it in Storage → New bucket → public: true)
--
-- After creating the bucket, run these storage policies:

-- Allow service-role (Edge Function) to upload
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'service_role_upload'
  ) THEN
    CREATE POLICY "service_role_upload"
      ON storage.objects FOR INSERT TO service_role
      WITH CHECK (bucket_id = 'student-photos');
  END IF;
END $$;

-- Allow anyone to read public photos
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'public_read_photos'
  ) THEN
    CREATE POLICY "public_read_photos"
      ON storage.objects FOR SELECT TO public
      USING (bucket_id = 'student-photos');
  END IF;
END $$;

-- Allow service-role to update / replace
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'service_role_update'
  ) THEN
    CREATE POLICY "service_role_update"
      ON storage.objects FOR UPDATE TO service_role
      USING (bucket_id = 'student-photos');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. alert_type enum — add 'hold' so we can notify when membership is paused
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'hold';
