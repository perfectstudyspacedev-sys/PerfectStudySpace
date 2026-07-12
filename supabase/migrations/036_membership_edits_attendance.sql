-- 036_membership_edits_attendance.sql
-- Extends membership_edits' edit_type to also cover attendance (check-in/check-out time)
-- corrections made via "Edit Attendance" on the Student Profile page, so those edits show
-- up in the same Edit History table as cabin/end-date edits instead of vanishing silently.
ALTER TABLE membership_edits DROP CONSTRAINT membership_edits_edit_type_check;
ALTER TABLE membership_edits ADD CONSTRAINT membership_edits_edit_type_check
  CHECK (edit_type IN ('cabin', 'end_date', 'attendance'));
