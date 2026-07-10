-- Update locker capacity and desk/seat counts for all 3 branches.
-- Branch mapping (per 006_owner_requests.sql, where these were first seeded):
--   Branch 1 = Ram Nagar, Branch 2 = 100 Feet Road, Branch 3 = Hopes
--
-- Lockers: Ram Nagar 15, 100 Feet Road 20, Hopes 45
-- Seats:   Ram Nagar 48, 100 Feet Road 57, Hopes 70
--
-- Desks are only ever ADDED here, never removed — deleting a desk that turns out to be
-- occupied (or tied to historical bookings) would corrupt the seat map, and the existing
-- `remove_desk` action already refuses to delete an occupied desk for that reason. If a
-- branch's actual desk count is already at or above its target, nothing happens for it.

UPDATE branches SET locker_capacity = 15 WHERE name = 'Ram Nagar';
UPDATE branches SET locker_capacity = 20 WHERE name = '100 Feet Road';
UPDATE branches SET locker_capacity = 45 WHERE name = 'Hopes';

DO $$
DECLARE
  b RECORD;
  target INT;
  current_count INT;
  max_label_num INT;
  i INT;
BEGIN
  FOR b IN SELECT id, name FROM branches WHERE name IN ('Ram Nagar', '100 Feet Road', 'Hopes') LOOP
    target := CASE b.name
      WHEN 'Ram Nagar' THEN 48
      WHEN '100 Feet Road' THEN 57
      WHEN 'Hopes' THEN 70
    END;

    SELECT COUNT(*) INTO current_count FROM desks WHERE branch_id = b.id;
    IF current_count < target THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(label, '\D', '', 'g'), '')::INT), 0)
        INTO max_label_num FROM desks WHERE branch_id = b.id;

      FOR i IN 1..(target - current_count) LOOP
        max_label_num := max_label_num + 1;
        INSERT INTO desks (branch_id, label, sort_order)
        VALUES (b.id, 'C' || max_label_num, max_label_num);
      END LOOP;
    END IF;

    UPDATE branches SET desk_count = (SELECT COUNT(*) FROM desks WHERE branch_id = b.id) WHERE id = b.id;
  END LOOP;
END $$;
