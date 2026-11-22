-- Records the timestamp of the owner's most recent successful login.
-- The Supabase API updates this column after successful owner authentication;
-- no frontend response fields or screens need to change.
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
