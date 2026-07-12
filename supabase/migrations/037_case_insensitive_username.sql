-- 037_case_insensitive_username.sql
-- Login usernames should not be case-sensitive ("Owner" and "owner" are the same account).
-- Replaces the plain UNIQUE(username) with a case-insensitive unique index so two accounts
-- can no longer differ only by case, and updates verify_staff_login to match case-insensitively.

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_username_key;
CREATE UNIQUE INDEX staff_username_lower_key ON staff (lower(username));

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
  WHERE lower(s.username) = lower(p_username)
    AND s.is_active = true
    AND s.password_hash = crypt(p_password, s.password_hash);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
