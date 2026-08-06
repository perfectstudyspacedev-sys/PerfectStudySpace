-- 041_admin_role_assign.sql
-- Converts the existing "admin" staff login to the new admin role. Split into its own
-- migration after 040_admin_role.sql: PostgreSQL cannot use a freshly-added enum value
-- (ALTER TYPE ... ADD VALUE) in the same transaction that added it, so the two must run as
-- separate statements/migrations, not combined.
--
-- Matches on lower(username) rather than a plain equality check — 037_case_insensitive_username
-- made staff logins case-insensitive (the live row is stored as "Admin", capital A), and a
-- plain `username = 'admin'` here would silently match zero rows and update nothing.

UPDATE staff SET role = 'admin' WHERE lower(username) = 'admin';
