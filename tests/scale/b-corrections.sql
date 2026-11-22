-- Local dummy stack only. Corrections on already-summed days must keep the summary
-- exact (trigger). After each step: summary+live equals live for the last 30 days.
\set ON_ERROR_STOP on
CREATE TEMP TABLE chk (step text, ok boolean);
CREATE OR REPLACE FUNCTION pg_temp.same() RETURNS boolean LANGUAGE sql AS $$
  SELECT report_revenue((SELECT array_agg(id) FROM branches), ((now() AT TIME ZONE 'Asia/Kolkata')::date - 29)::timestamp AT TIME ZONE 'Asia/Kolkata',
           (((now() AT TIME ZONE 'Asia/Kolkata')::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') - interval '1 microsecond')
       = report_revenue_live((SELECT array_agg(id) FROM branches), ((now() AT TIME ZONE 'Asia/Kolkata')::date - 29)::timestamp AT TIME ZONE 'Asia/Kolkata',
           (((now() AT TIME ZONE 'Asia/Kolkata')::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') - interval '1 microsecond') $$;
INSERT INTO transactions (id, student_id, branch_id, category, amount, payment_mode, created_at)
  SELECT '00000000-0000-4000-8000-000000000001', id, branch_id, 'locker', 333.33, 'cash', now() - interval '5 days' FROM students ORDER BY s_no LIMIT 1;
INSERT INTO chk SELECT '1 backdated payment added', pg_temp.same();
UPDATE transactions SET amount = 444.44 WHERE id = '00000000-0000-4000-8000-000000000001';
INSERT INTO chk SELECT '2 its amount edited', pg_temp.same();
UPDATE transactions SET branch_id = (SELECT id FROM branches ORDER BY name DESC LIMIT 1) WHERE id = '00000000-0000-4000-8000-000000000001';
INSERT INTO chk SELECT '3 moved to another branch', pg_temp.same();
DELETE FROM payouts WHERE id = (SELECT id FROM payouts WHERE created_at < now() - interval '3 days' ORDER BY created_at LIMIT 1);
INSERT INTO chk SELECT '4 a past payout deleted', pg_temp.same();
DELETE FROM transactions WHERE id = '00000000-0000-4000-8000-000000000001';
INSERT INTO chk SELECT '5 the backdated payment deleted again', pg_temp.same();
SELECT step, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM chk;
