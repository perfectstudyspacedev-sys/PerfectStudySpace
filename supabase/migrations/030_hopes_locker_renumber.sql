-- The physical lockers at the Hopes branch are labeled 1-10, then 25-46, then 63-75
-- (45 units total, with gaps) rather than a plain 1..45 sequence. Remap any currently
-- active locker assignments there to match the real labels, by rank order of their
-- current (sequential) number. Historical/inactive locker records are left untouched
-- since they're just past history, not something a student needs to find on the wall.

DO $$
DECLARE
  hopes_id UUID;
BEGIN
  SELECT id INTO hopes_id FROM branches WHERE name = 'Hopes';
  IF hopes_id IS NULL THEN
    RETURN;
  END IF;

  CREATE TEMP TABLE hopes_locker_remap ON COMMIT DROP AS
  SELECT old.id, new.label AS new_label
  FROM (
    SELECT id, row_number() OVER (ORDER BY locker_no::INT) AS rn
    FROM lockers WHERE branch_id = hopes_id AND is_active = true
  ) old
  JOIN (
    SELECT n::TEXT AS label, row_number() OVER () AS rn
    FROM unnest(
      ARRAY(SELECT generate_series(1, 10)) ||
      ARRAY(SELECT generate_series(25, 46)) ||
      ARRAY(SELECT generate_series(63, 75))
    ) AS n
  ) new ON new.rn = old.rn;

  -- Two-phase rename avoids tripping the UNIQUE(branch_id, locker_no) constraint,
  -- since the new labels overlap the old 1..45 range.
  UPDATE lockers SET locker_no = 'tmp-' || id::TEXT
  WHERE id IN (SELECT id FROM hopes_locker_remap);

  UPDATE lockers l SET locker_no = r.new_label
  FROM hopes_locker_remap r
  WHERE l.id = r.id;
END $$;
