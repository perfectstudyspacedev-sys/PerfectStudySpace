-- DUMMY data at the size the hardening is for: 20,000 students over 10 branches and two
-- years of history, for npm run test:scale -- --seed large. Never run this against a real
-- database: it resets staff passwords and adds about two million rows.
--
-- 20,000 students (2,000 per branch) joined over 24 months; each has 1 to 6 monthly
-- memberships in a row, the latest one active; members study on about two of every three
-- days of each membership; one payment per membership month plus food and desk payments;
-- 3,000 open sessions; cashbacks, unbilled overtime, alerts, enquiries and tasks to match.
-- Logins as in seed-small.sql: owner/local-owner-pass, localadmin/local-admin-pass,
-- staff_<n>/local-staff-pass (n = branch 1..10 by name order).
\set ON_ERROR_STOP on
BEGIN;
SELECT setseed(0.42);

-- 7 more branches next to the 3 the migrations create, with desks.
INSERT INTO branches (name, desk_count, is_active)
  SELECT 'Test Branch ' || g, 60, true FROM generate_series(1, 7) g;
INSERT INTO desks (branch_id, label, sort_order)
  SELECT b.id, 'C' || d, d FROM branches b, generate_series(1, 60) d WHERE b.name LIKE 'Test Branch %';

CREATE TEMP TABLE b AS SELECT id, row_number() OVER (ORDER BY name) - 1 AS k FROM branches WHERE is_active;
CREATE TEMP TABLE d AS SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today;

UPDATE staff SET password_hash = hash_staff_password('local-owner-pass') WHERE username = 'owner';
INSERT INTO staff (username, password_hash, role, display_name)
  VALUES ('localadmin', hash_staff_password('local-admin-pass'), 'admin', 'Local Admin');
INSERT INTO staff (username, password_hash, role, display_name, branch_id)
  SELECT 'staff_' || (k + 1), hash_staff_password('local-staff-pass'), 'staff', 'Staff ' || (k + 1), id FROM b;

-- Students: joined on a day within the last 24 months; 1 to 6 membership months.
CREATE TEMP TABLE s AS
  SELECT i, gen_random_uuid() AS id, (SELECT id FROM b WHERE k = i % 10) AS branch_id,
         (SELECT today FROM d) - (i * 7919 % 720) AS joined, 1 + (i * 31 % 6) AS months
  FROM generate_series(1, 20000) i;
INSERT INTO students (id, s_no, name, phone, course, status, branch_id, total_visits, total_hours_studied, created_at, referral_source)
  SELECT id, i, 'Student ' || lpad(i::text, 5, '0'), (9000000000 + i)::text, 'Course ' || (i % 9), 'active', branch_id,
         0, 0, joined::timestamp AT TIME ZONE 'Asia/Kolkata' + interval '10 hours',
         (ARRAY['google_search','instagram','word_of_mouth','flex','ai_platform'])[1 + i % 5]
  FROM s;

-- Memberships: one per month in a row; only the last is active.
CREATE TEMP TABLE m AS
  SELECT s.i, gen_random_uuid() AS id, s.id AS student_id, s.branch_id, n,
         s.joined + (n - 1) * 30 AS start_date, s.joined + n * 30 - 1 AS end_date, n = s.months AS active,
         CASE WHEN s.i % 10 < 7 THEN 'temporary' ELSE 'permanent' END::membership_category AS category
  FROM s, generate_series(1, 6) n WHERE n <= s.months AND s.joined + (n - 1) * 30 <= (SELECT today FROM d);
INSERT INTO memberships (id, student_id, branch_id, category, seat_type, cabin_no, month, hours_per_day, timings,
                         start_date, end_date, due_date, months_paid, monthly_fee, total_paid, fee_due, is_active, payment_mode, created_at)
  SELECT id, student_id, branch_id, category, CASE WHEN category = 'permanent' THEN 'fixed' ELSE 'floating' END::seat_type,
         'C' || (1 + i % 60), to_char(start_date, 'Mon YYYY'), 6, '9-3', start_date, end_date, start_date + 30, 1, 1000,
         CASE WHEN active AND i % 10 < 3 THEN 900 ELSE 1000 END, CASE WHEN active AND i % 10 < 3 THEN 100 ELSE 0 END,
         active, 'cash', start_date::timestamp AT TIME ZONE 'Asia/Kolkata' + interval '10 hours'
  FROM m;

-- Sessions: about two of every three days of each membership, up to yesterday.
INSERT INTO bookings (student_id, branch_id, membership_id, booking_type, start_time, end_time, hours, scheduled_hours, status, created_at)
  SELECT m.student_id, m.branch_id, m.id, m.category::text::booking_type,
         g.day::timestamp AT TIME ZONE 'Asia/Kolkata' + interval '9 hours',
         g.day::timestamp AT TIME ZONE 'Asia/Kolkata' + interval '15 hours', 6, 6, 'completed',
         g.day::timestamp AT TIME ZONE 'Asia/Kolkata' + interval '9 hours'
  FROM m, d, LATERAL (SELECT x::date AS day FROM generate_series(m.start_date, least(m.end_date, d.today - 1), interval '1 day') x) g
  WHERE (m.i + (g.day - m.start_date)) % 3 <> 0;
-- 3,000 open sessions right now (members whose last membership is still valid).
INSERT INTO bookings (student_id, branch_id, membership_id, booking_type, start_time, end_time, hours, scheduled_hours, status, created_at)
  SELECT o.student_id, o.branch_id, o.id, o.category::text::booking_type, now() - interval '2 hours', now() + interval '4 hours', 6, 6, 'active', now() - interval '2 hours'
  FROM (SELECT m.* FROM m, d WHERE m.active AND m.end_date >= d.today ORDER BY m.i LIMIT 3000) o;

-- Money: one payment per membership month; food or desk payments on one weekday of sessions.
INSERT INTO transactions (student_id, branch_id, membership_id, category, amount, payment_mode, created_at)
  SELECT student_id, branch_id, id, 'membership', CASE WHEN active AND i % 10 < 3 THEN 900 ELSE 1000 END,
         CASE WHEN i % 2 = 0 THEN 'cash' ELSE 'upi' END::payment_mode, start_date::timestamp AT TIME ZONE 'Asia/Kolkata' + interval '10 hours'
  FROM m;
INSERT INTO transactions (student_id, branch_id, booking_id, category, amount, payment_mode, created_at)
  SELECT student_id, branch_id, id, CASE WHEN extract(day FROM start_time) < 16 THEN 'food' ELSE 'desk' END::transaction_category,
         40 + (extract(day FROM start_time)::int % 5) * 10, 'cash', start_time + interval '3 hours'
  FROM bookings WHERE status = 'completed' AND extract(dow FROM start_time) = 2;
INSERT INTO payouts (student_id, branch_id, payout_type, amount, created_at)
  SELECT student_id, branch_id, (ARRAY['cashback','locker_deposit','food_pass_refund','membership_refund'])[1 + i % 4], 50 + i % 7,
         end_date::timestamp AT TIME ZONE 'Asia/Kolkata' + interval '12 hours'
  FROM m WHERE NOT active AND i % 9 = 0;
INSERT INTO cashbacks (student_id, branch_id, month_label, cashback_type, cashback_value, status, redeemed_amount, redeemed_at, created_at)
  SELECT student_id, branch_id, 'Month ' || n, CASE WHEN i % 2 = 0 THEN 'fixed' ELSE 'percent' END, CASE WHEN i % 2 = 0 THEN 50 ELSE 5 END,
         CASE WHEN active THEN 'pending' ELSE 'redeemed' END, CASE WHEN active THEN NULL ELSE 50 END,
         CASE WHEN active THEN NULL ELSE end_date::timestamp AT TIME ZONE 'Asia/Kolkata' END, start_date::timestamp AT TIME ZONE 'Asia/Kolkata'
  FROM m WHERE i % 4 = 0;
INSERT INTO overtime_sessions (student_id, membership_id, branch_id, overtime_minutes, session_date, billed_amount, excluded)
  SELECT student_id, id, branch_id, 75, d.today - 1, 10, false FROM m, d WHERE active AND i % 3 = 0;
INSERT INTO food_bills (branch_id, student_id, student_name, subtotal, total, paid, payment_mode, created_at)
  SELECT branch_id, student_id, 'Student', 80, 80, true, 'cash', start_time + interval '2 hours'
  FROM bookings WHERE status = 'completed' AND extract(dow FROM start_time) = 4;
INSERT INTO food_passes (student_id, branch_id, balance) SELECT student_id, branch_id, 100 FROM m WHERE active AND i % 5 = 0;
INSERT INTO lockers (branch_id, student_id, locker_no, monthly_fee, locker_due_date, deposit_amount, is_active, fee_due)
  SELECT m.branch_id, m.student_id, ((m.i - 1) / 10 + 1)::text, 100, CASE WHEN m.i % 3 = 0 THEN d.today - 5 ELSE d.today + 20 END, 200, true, 0
  FROM m, d WHERE m.active AND m.i <= 400;
INSERT INTO alerts (student_id, branch_id, alert_type, due_date, message, status)
  SELECT student_id, branch_id, 'expiry', end_date, 'Dummy alert', 'pending' FROM m WHERE active;
INSERT INTO enquiries (branch_id, name, phone, source, status, created_at)
  SELECT (SELECT id FROM b WHERE k = g % 10), 'Enquiry ' || g, (8000000000 + g)::text, 'walk_in', 'new', now() - make_interval(hours => g % 17000)
  FROM generate_series(1, 30000) g;
CREATE TEMP TABLE st AS SELECT s.id, s.branch_id FROM staff s WHERE s.username LIKE 'staff\_%';
INSERT INTO tasks (branch_id, assigned_by_staff_id, assigned_to_staff_id, title, status, due_date, repeat_interval, created_at)
  SELECT st.branch_id, (SELECT id FROM staff WHERE username = 'owner'), st.id, 'Task ' || g, CASE WHEN g % 4 = 0 THEN 'pending' ELSE 'done' END,
         d.today - (g % 300), 'none', now() - make_interval(days => g % 300)
  FROM d, st, generate_series(1, 400) g;
COMMIT;

-- Keep the per-student counters roughly right (some pages show them).
UPDATE students s SET total_visits = x.n, total_hours_studied = x.h
  FROM (SELECT student_id, count(*) n, sum(hours) h FROM bookings GROUP BY student_id) x WHERE x.student_id = s.id;
ANALYZE;
SELECT public.refresh_revenue_summary();

SELECT 'students' AS t, count(*) FROM students
UNION ALL SELECT 'branches', count(*) FROM branches
UNION ALL SELECT 'memberships (active)', count(*) FILTER (WHERE is_active) FROM memberships
UNION ALL SELECT 'memberships (all)', count(*) FROM memberships
UNION ALL SELECT 'bookings', count(*) FROM bookings
UNION ALL SELECT 'bookings open', count(*) FROM bookings WHERE status = 'active'
UNION ALL SELECT 'transactions', count(*) FROM transactions
UNION ALL SELECT 'food_bills', count(*) FROM food_bills
UNION ALL SELECT 'enquiries', count(*) FROM enquiries
UNION ALL SELECT 'tasks', count(*) FROM tasks;
