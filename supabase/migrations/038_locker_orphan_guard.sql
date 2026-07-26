-- 038_locker_orphan_guard.sql
-- lockers.student_id is ON DELETE SET NULL, so deleting a student left their locker row
-- behind still flagged is_active with student_id wiped. Those orphans kept occupying their
-- locker number (blocking reassignment and under-reporting available capacity) and kept
-- deposit_returned = false, so the books showed a deposit still owed to a student who no
-- longer exists. Six such rows had accumulated at one branch, hiding 6 of 15 lockers.
--
-- Rather than change the FK to CASCADE (which would silently erase the historical locker
-- record along with the student), release the locker automatically when it loses its owner:
-- the row survives for audit, but stops holding a number and stops claiming an open deposit.

CREATE OR REPLACE FUNCTION release_orphaned_locker()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.student_id IS NULL AND OLD.student_id IS NOT NULL AND NEW.is_active THEN
    NEW.is_active := false;
    NEW.deposit_returned := true;
    NEW.fee_due := 0;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_release_orphaned_locker ON lockers;
CREATE TRIGGER trg_release_orphaned_locker
  BEFORE UPDATE ON lockers
  FOR EACH ROW
  EXECUTE FUNCTION release_orphaned_locker();
