-- 010_storage_anon_upload.sql  ·  Run this in Supabase SQL Editor
-- Fixes "Failed to upload Aadhaar photo" — the frontend uploads directly to
-- Supabase Storage using the anon key (not through the edge function), but no
-- RLS policy existed granting the anon role INSERT access to the bucket.
-- Migration 002 only granted service_role upload/update, so every anon upload
-- was being rejected by Storage's row-level security.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'anon_upload_photos'
  ) THEN
    CREATE POLICY "anon_upload_photos"
      ON storage.objects FOR INSERT TO anon
      WITH CHECK (bucket_id = 'student-photos');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'anon_update_photos'
  ) THEN
    CREATE POLICY "anon_update_photos"
      ON storage.objects FOR UPDATE TO anon
      USING (bucket_id = 'student-photos');
  END IF;
END $$;
