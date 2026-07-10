-- Replace the old 4-bucket walk-in pricing (3/6/8/12 hrs) with exact per-hour
-- tiers matching every option in the walk-in booking dropdown.
DELETE FROM fee_config WHERE config_type = 'walkin';

INSERT INTO fee_config (config_type, max_hours, fee, sort_order) VALUES
  ('walkin', 3, 35, 1),
  ('walkin', 4, 45, 2),
  ('walkin', 5, 55, 3),
  ('walkin', 6, 60, 4),
  ('walkin', 7, 70, 5),
  ('walkin', 8, 80, 6),
  ('walkin', 9, 90, 7),
  ('walkin', 12, 100, 8);
