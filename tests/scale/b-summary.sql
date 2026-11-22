-- Local dummy stack only. Summary+live (report_revenue) vs rows (report_revenue_live)
-- for many IST day ranges and branch scopes. One NOTICE per mismatch, then totals.
CREATE TEMP TABLE r (scope text, from_day date, to_day date, ok boolean);
DO $$
DECLARE
  sc uuid[]; d0 date := (now() AT TIME ZONE 'Asia/Kolkata')::date; a date; b date; l jsonb; s jsonb; label text;
BEGIN
  FOR label, sc IN SELECT 'all', array_agg(id) FROM branches UNION ALL SELECT name, ARRAY[id] FROM branches LOOP
    FOR a, b IN SELECT d0 - x, d0 - y FROM (VALUES (0,0),(1,1),(3,3),(6,0),(29,0),(40,2),(90,0),(400,0),(10,5),(2,1)) v(x,y) LOOP
      l := report_revenue_live(sc, a::timestamp AT TIME ZONE 'Asia/Kolkata', ((b + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') - interval '1 microsecond');
      s := report_revenue(sc, a::timestamp AT TIME ZONE 'Asia/Kolkata', ((b + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') - interval '1 microsecond');
      INSERT INTO r VALUES (label, a, b, l = s);
      IF l <> s THEN RAISE NOTICE 'MISMATCH % % to %: live % summary %', label, a, b, left(l::text, 120), left(s::text, 120); END IF;
    END LOOP;
  END LOOP;
END $$;
SELECT count(*) AS ranges_compared, count(*) FILTER (WHERE ok) AS identical FROM r;
