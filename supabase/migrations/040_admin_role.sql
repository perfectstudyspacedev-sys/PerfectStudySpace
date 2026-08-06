-- 040_admin_role.sql
-- A role above owner: can edit/delete any row in a student's Payment History, Cashback
-- History, Discounts, and Overtime History tables (with the related state reverted), and
-- is invisible to the owner role everywhere — the Staff tab, staff counts, branch grids,
-- everything. Postgres enums can only gain values, never lose or reorder them, so this is
-- additive and safe to run on the live table.

ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'admin';
