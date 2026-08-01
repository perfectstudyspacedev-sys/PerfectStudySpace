-- 039_delete_membership_reason.sql
-- Delete Membership is now available to all staff, not just owners — the most
-- destructive membership action in the app, so it's gated on a required reason
-- instead of a role check. Reuses membership_edits (same audit trail as
-- cabin/end-date/attendance edits) rather than a new table.
ALTER TABLE membership_edits DROP CONSTRAINT IF EXISTS membership_edits_edit_type_check;
ALTER TABLE membership_edits ADD CONSTRAINT membership_edits_edit_type_check
  CHECK (edit_type IN ('cabin', 'end_date', 'attendance', 'delete_membership'));
