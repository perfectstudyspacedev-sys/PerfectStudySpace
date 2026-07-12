-- 034_booking_scheduled_hours.sql
-- bookings.hours gets overwritten by update_attendance every time staff corrects a session's
-- times (it's recomputed as the actual total duration), so it can't also serve as the stable
-- "originally booked/allotted length" that overtime billing needs as its baseline — after a
-- second edit, that baseline would silently be the actual duration from the *first* edit
-- instead of the student's true original session length. scheduled_hours is set once at
-- creation and never touched again, giving overtime recomputation a permanent anchor.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS scheduled_hours NUMERIC(6,2);
UPDATE bookings SET scheduled_hours = hours WHERE scheduled_hours IS NULL;
