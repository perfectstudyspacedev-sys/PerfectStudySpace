-- DUMMY data for the local PSS rehearsal stack (setup-local.sh). Never run this
-- against a real database: it resets staff passwords and adds thousands of rows.
--
-- 1,500 students over the 3 branches the migrations create (500 each), sized so
-- every list that can grow passes 1000 rows somewhere, all-branches or per branch:
--   students 1500 | active memberships 1500 (1100 still valid, 400 expired) and
--   1500 old inactive ones | fee due on 1200 | ~15,000 finished sessions in the
--   last 20 days + 1200 walk-ins | 1150 open sessions | 4500 transactions |
--   3600 cashbacks (1200 pending, 1200 per branch) | 1300 unbilled overtime rows |
--   2650 food bills | 1100 food passes | 4500 pending alerts (1500 per branch) |
--   3500 enquiries | 1250 tasks, 150 of them daily with 7 days of completions
-- Names are "Student 0001" and so on; phones are 90000xxxxx. Staff logins
-- (dummy passwords, local only): owner/local-owner-pass, localadmin/local-admin-pass,
-- staff_<n>/local-staff-pass for branch 1..3 (by name order).
\set ON_ERROR_STOP on
BEGIN;
SELECT setseed(0.42);

CREATE TEMP TABLE b AS
  SELECT id, row_number() OVER (ORDER BY name) - 1 AS k FROM branches WHERE is_active;
CREATE TEMP TABLE d AS SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today;

-- ── staff ──────────────────────────────────────────────────────────────────
UPDATE staff SET password_hash = hash_staff_password('local-owner-pass') WHERE username = 'owner';
INSERT INTO staff (username, password_hash, role, display_name)
  VALUES ('localadmin', hash_staff_password('local-admin-pass'), 'admin', 'Local Admin');
INSERT INTO staff (username, password_hash, role, display_name, branch_id)
  SELECT 'staff_' || (k + 1), hash_staff_password('local-staff-pass'), 'staff', 'Staff ' || (k + 1), id FROM b;

-- ── students ───────────────────────────────────────────────────────────────
CREATE TEMP TABLE s AS
  SELECT i, gen_random_uuid() AS id, (SELECT id FROM b WHERE k = i % 3) AS branch_id
  FROM generate_series(1, 1500) i;
INSERT INTO students (id, s_no, name, phone, course, status, branch_id, total_visits, total_hours_studied,
                      created_at, referral_source)
  SELECT id, i, 'Student ' || lpad(i::text, 4, '0'), (9000000000 + i)::text, 'Course ' || (i % 7), 'active',
         branch_id, 10, 60, now() - make_interval(days => i % 60),
         (ARRAY['google_search','instagram','word_of_mouth','flex','ai_platform'])[1 + i % 5]
  FROM s;

-- ── memberships: one active per student, plus one old inactive one ───────────
CREATE TEMP TABLE m AS
  SELECT s.i, gen_random_uuid() AS id, s.id AS student_id, s.branch_id,
         CASE WHEN s.i % 10 < 7 THEN 'temporary' ELSE 'permanent' END::membership_category AS category,
         CASE WHEN s.i <= 400 THEN d.today - (20 + s.i % 20) ELSE d.today - (s.i % 25) END AS start_date,
         CASE WHEN s.i <= 400 THEN d.today - (1 + s.i % 20) ELSE d.today + (s.i % 30) END AS end_date
  FROM s, d;
INSERT INTO memberships (id, student_id, branch_id, category, seat_type, cabin_no, month, hours_per_day, timings,
                         start_date, end_date, due_date, months_paid, monthly_fee, total_paid, fee_due,
                         is_active, payment_mode, created_at)
  SELECT id, student_id, branch_id, category,
         CASE WHEN category = 'permanent' THEN 'fixed' ELSE 'floating' END::seat_type,
         'C' || (1 + i % 50), to_char(start_date, 'Mon YYYY'), 6, '9-3',
         start_date, end_date, start_date + 30, 1, 1000,
         CASE WHEN i % 10 < 8 THEN 900 ELSE 1000 END, CASE WHEN i % 10 < 8 THEN 100 ELSE 0 END,
         true, 'cash', CASE WHEN i > 400 THEN now() - make_interval(hours => i % 400) ELSE now() - interval '40 days' END
  FROM m;
INSERT INTO memberships (student_id, branch_id, category, seat_type, hours_per_day, start_date, end_date, due_date,
                         months_paid, monthly_fee, total_paid, fee_due, is_active, payment_mode, created_at)
  SELECT student_id, branch_id, category, 'floating', 6, start_date - 90, start_date - 61, start_date - 60,
         1, 1000, 1000, 0, false, 'cash', now() - interval '95 days'
  FROM m;

-- ── sessions ───────────────────────────────────────────────────────────────
-- Finished member sessions: every other day over the last 20 days (about 10 each).
INSERT INTO bookings (student_id, branch_id, membership_id, booking_type, start_time, end_time, hours,
                      scheduled_hours, status, created_at)
  SELECT m.student_id, m.branch_id, m.id, m.category::text::booking_type,
         (d.today - g.day)::timestamp AT TIME ZONE 'Asia/Kolkata' + interval '9 hours',
         (d.today - g.day)::timestamp AT TIME ZONE 'Asia/Kolkata' + interval '15 hours',
         6, 6, 'completed',
         (d.today - g.day)::timestamp AT TIME ZONE 'Asia/Kolkata' + interval '9 hours'
  FROM m, d, generate_series(1, 20) AS g(day)
  WHERE (m.i + g.day) % 2 = 0;
-- 1200 finished walk-ins over the last 15 days.
INSERT INTO bookings (student_id, branch_id, booking_type, start_time, end_time, hours, scheduled_hours, amount,
                      status, payment_mode, created_at)
  SELECT s.id, s.branch_id, 'walkin',
         (d.today - (s.i % 15) - 1)::timestamp AT TIME ZONE 'Asia/Kolkata' + interval '10 hours',
         (d.today - (s.i % 15) - 1)::timestamp AT TIME ZONE 'Asia/Kolkata' + interval '13 hours',
         3, 3, 35, 'completed', 'cash',
         (d.today - (s.i % 15) - 1)::timestamp AT TIME ZONE 'Asia/Kolkata' + interval '10 hours'
  FROM s, d WHERE s.i <= 1200;
-- 1150 open sessions right now: 1050 members, 100 walk-ins.
CREATE TEMP TABLE ob AS
  SELECT s.i, gen_random_uuid() AS id, s.id AS student_id, s.branch_id, m.id AS membership_id,
         CASE WHEN s.i <= 1050 THEN m.category::text::booking_type ELSE 'walkin'::booking_type END AS booking_type
  FROM s JOIN m ON m.i = s.i WHERE s.i <= 1150;
INSERT INTO bookings (id, student_id, branch_id, membership_id, booking_type, start_time, end_time, hours,
                      scheduled_hours, status, created_at)
  SELECT id, student_id, branch_id, CASE WHEN booking_type = 'walkin' THEN NULL ELSE membership_id END, booking_type,
         now() - interval '2 hours', now() + interval '4 hours', 6, 6, 'active', now() - interval '2 hours'
  FROM ob;

-- ── money ──────────────────────────────────────────────────────────────────
INSERT INTO transactions (student_id, branch_id, membership_id, category, amount, payment_mode, created_at)
  SELECT m.student_id, m.branch_id, m.id, c.cat::transaction_category, c.amt, 'cash',
         now() - make_interval(hours => (m.i * 7 + c.n) % 400)
  FROM m, (VALUES (1, 'membership', 900), (2, 'desk', 35), (3, 'food', 60)) AS c(n, cat, amt);
-- 3 cashbacks for 4 of every 5 students: one pending, two redeemed.
INSERT INTO cashbacks (student_id, branch_id, month_label, cashback_type, cashback_value, status,
                       redeemed_amount, redeemed_at, created_at)
  SELECT m.student_id, m.branch_id, 'Month ' || c.n,
         CASE WHEN m.i % 2 = 0 THEN 'fixed' ELSE 'percent' END, CASE WHEN m.i % 2 = 0 THEN 50 ELSE 5 END,
         CASE WHEN c.n = 1 THEN 'pending' ELSE 'redeemed' END,
         CASE WHEN c.n = 1 THEN NULL ELSE 50 END,
         CASE WHEN c.n = 1 THEN NULL ELSE now() - make_interval(days => c.n * 3) END,
         now() - make_interval(days => c.n * 10)
  FROM m, generate_series(1, 3) AS c(n) WHERE m.i % 5 <> 0;
INSERT INTO overtime_sessions (student_id, membership_id, branch_id, overtime_minutes, session_date, billed_amount, excluded)
  SELECT m.student_id, m.id, m.branch_id, 75, d.today - 1, 10, false FROM m, d WHERE m.i <= 1300;

-- ── food ───────────────────────────────────────────────────────────────────
-- Unpaid bills on 1100 of the open sessions, and 1500 paid bills over the month.
INSERT INTO food_bills (branch_id, student_id, booking_id, student_name, subtotal, total, paid, created_at)
  SELECT ob.branch_id, ob.student_id, ob.id, 'Student ' || lpad(ob.i::text, 4, '0'), 40, 40, false, now() - interval '1 hour'
  FROM ob WHERE ob.i <= 1100;
INSERT INTO food_bills (branch_id, student_id, student_name, subtotal, total, paid, payment_mode, created_at)
  SELECT s.branch_id, s.id, 'Student ' || lpad(s.i::text, 4, '0'), 80, 80, true, 'cash', now() - make_interval(hours => s.i % 400)
  FROM s;
-- 50 more with a discount, for the discounts report.
INSERT INTO food_bills (branch_id, student_id, student_name, subtotal, discount_type, discount_value, discount_amount,
                        total, paid, payment_mode, created_at)
  SELECT s.branch_id, s.id, 'Student ' || lpad(s.i::text, 4, '0'), 100, 'fixed', 10, 10, 90, true, 'cash', now() - interval '2 days'
  FROM s WHERE s.i <= 50;
INSERT INTO food_passes (student_id, branch_id, balance)
  SELECT s.id, s.branch_id, CASE WHEN s.i <= 5 THEN -20 ELSE 100 END FROM s WHERE s.i <= 1100;

-- ── lockers: 30 per branch, a third of them overdue ────────────────────────
INSERT INTO lockers (branch_id, student_id, locker_no, monthly_fee, locker_due_date, deposit_amount, is_active, fee_due)
  SELECT s.branch_id, s.id, ((s.i - 1) / 3 + 1)::text, 100,
         CASE WHEN s.i % 3 = 0 THEN d.today - 5 ELSE d.today + 20 END, 200, true, 0
  FROM s, d WHERE s.i <= 90;

-- ── alerts, enquiries, tasks ───────────────────────────────────────────────
INSERT INTO alerts (student_id, branch_id, alert_type, due_date, message, status)
  SELECT s.id, s.branch_id, t.typ::alert_type, d.today + (s.i % 7), 'Dummy alert ' || t.typ, 'pending'
  FROM s, d, (VALUES ('expiry'), ('payment_due'), ('hold')) AS t(typ);
INSERT INTO enquiries (branch_id, name, phone, source, status, created_at)
  SELECT (SELECT id FROM b WHERE k = g % 3), 'Enquiry ' || g, (8000000000 + g)::text, 'walk_in', 'new',
         now() - make_interval(hours => g % 1000)
  FROM generate_series(1, 3500) g;
CREATE TEMP TABLE st AS
  SELECT s.id, s.branch_id FROM staff s WHERE s.username LIKE 'staff\_%';
INSERT INTO tasks (branch_id, assigned_by_staff_id, assigned_to_staff_id, title, status, due_date, repeat_interval, created_at)
  SELECT st.branch_id, (SELECT id FROM staff WHERE username = 'owner'), st.id, 'One-off task ' || g,
         CASE WHEN g % 4 = 0 THEN 'pending' ELSE 'done' END, d.today - (g % 30), 'none', now() - make_interval(days => 30 + g % 30)
  FROM d, generate_series(1, 1100) g JOIN st ON true
  WHERE st.branch_id = (SELECT id FROM b WHERE k = g % 3);
INSERT INTO tasks (branch_id, assigned_by_staff_id, assigned_to_staff_id, title, status, due_date, repeat_interval, created_at)
  SELECT st.branch_id, (SELECT id FROM staff WHERE username = 'owner'), st.id, 'Daily task ' || g,
         'pending', d.today - 40, 'daily', now() - interval '40 days'
  FROM d, generate_series(1, 150) g JOIN st ON true
  WHERE st.branch_id = (SELECT id FROM b WHERE k = g % 3);
INSERT INTO task_completions (task_id, completion_date)
  SELECT t.id, d.today - g FROM tasks t, d, generate_series(1, 7) g WHERE t.repeat_interval = 'daily';

COMMIT;
ANALYZE;

SELECT 'students' AS t, count(*) FROM students
UNION ALL SELECT 'memberships active', count(*) FROM memberships WHERE is_active
UNION ALL SELECT 'bookings', count(*) FROM bookings
UNION ALL SELECT 'bookings open', count(*) FROM bookings WHERE status = 'active'
UNION ALL SELECT 'transactions', count(*) FROM transactions
UNION ALL SELECT 'cashbacks', count(*) FROM cashbacks
UNION ALL SELECT 'overtime_sessions', count(*) FROM overtime_sessions
UNION ALL SELECT 'food_bills', count(*) FROM food_bills
UNION ALL SELECT 'alerts', count(*) FROM alerts
UNION ALL SELECT 'enquiries', count(*) FROM enquiries
UNION ALL SELECT 'tasks', count(*) FROM tasks
UNION ALL SELECT 'task_completions', count(*) FROM task_completions;
