-- Brute-force protection: lock a staff account out for 15 minutes after 5 consecutive
-- failed login attempts. Without this, the login RPC could be hammered with unlimited
-- password guesses against a known username with no throttling at all.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS failed_login_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION register_failed_login(p_username TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE staff
  SET failed_login_attempts = failed_login_attempts + 1,
      locked_until = CASE WHEN failed_login_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
  WHERE username = p_username;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION register_login_success(p_staff_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE staff SET failed_login_attempts = 0, locked_until = NULL WHERE id = p_staff_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Locked-out accounts must never authenticate, even with the correct password.
CREATE OR REPLACE FUNCTION verify_staff_login(p_username TEXT, p_password TEXT)
RETURNS TABLE (
  id UUID,
  username TEXT,
  role staff_role,
  display_name TEXT,
  branch_id UUID,
  branch_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.username, s.role, s.display_name, s.branch_id, b.name
  FROM staff s
  LEFT JOIN branches b ON b.id = s.branch_id
  WHERE s.username = p_username
    AND s.is_active = true
    AND (s.locked_until IS NULL OR s.locked_until < now())
    AND s.password_hash = crypt(p_password, s.password_hash);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
