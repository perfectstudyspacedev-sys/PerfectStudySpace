-- 053_scale_hardening.sql
-- Hardening for 20,000 students, 10+ branches and years of data. Append-only:
-- creates new tables, functions and indexes and changes one role setting; it
-- never alters or drops an existing column, row or policy. Safe to run twice.
-- Applied to the cloud project by hand in the SQL editor BEFORE the matching
-- api function is deployed (the api checks for what it needs and falls back
-- to the old behaviour while this migration is missing).

-- ── G. Database safety ─────────────────────────────────────────────────────
-- The api reaches the database as service_role (through PostgREST). It had no
-- timeout of its own, so the login role's 8 s applied to every query, reports
-- included. 30 s for the api's role; PostgREST applies the impersonated role's
-- statement_timeout per request. anon (3 s) and authenticated (8 s) unchanged.
ALTER ROLE service_role SET statement_timeout = '30s';

-- ── F. Login protection ────────────────────────────────────────────────────
-- Every failed staff login, by lower-cased username and client IP. Readable
-- only by the api (service_role); purged after a day by purge_scale_tables().
CREATE TABLE IF NOT EXISTS public.login_failures (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username text NOT NULL,
  ip text NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_failures_username ON public.login_failures (username, failed_at);
CREATE INDEX IF NOT EXISTS idx_login_failures_ip ON public.login_failures (ip, failed_at);
ALTER TABLE public.login_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.login_failures FROM anon, authenticated;

-- When the next login for this username or IP is allowed again; NULL when not
-- locked. A lock starts at any failure that was the 5th within 15 minutes (for
-- the same username, or the same IP) and lasts 15 minutes from it. Attempts
-- refused during a lock are not recorded, so a lock always ends on time.
-- p_ip NULL (address unknown) checks the username only.
CREATE OR REPLACE FUNCTION public.login_locked_until(p_username text, p_ip text)
RETURNS timestamptz
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT max(failed_at) + interval '15 minutes'
  FROM (
    SELECT failed_at, lag(failed_at, 4) OVER (PARTITION BY k ORDER BY failed_at) AS four_before
    FROM (
      SELECT 'u' AS k, failed_at FROM login_failures
       WHERE username = lower(p_username) AND failed_at > now() - interval '30 minutes'
      UNION ALL
      SELECT 'i', failed_at FROM login_failures
       WHERE p_ip IS NOT NULL AND ip = p_ip AND failed_at > now() - interval '30 minutes'
    ) f
  ) w
  WHERE four_before IS NOT NULL AND failed_at - four_before <= interval '15 minutes'
  HAVING max(failed_at) + interval '15 minutes' > now();
$$;
REVOKE ALL ON FUNCTION public.login_locked_until(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_locked_until(text, text) TO service_role;

-- ── A. Counting and summing in the database ────────────────────────────────
-- The api used to fetch every row of a period (thousands, paged 1000 at a time) and
-- add them up in JavaScript. Each report is now one function returning ONE jsonb
-- value, so PostgREST's 1000-row cap never applies and only totals cross the wire.
-- Filters are exactly the api's previous ones, quirks included (a payment without a
-- payment mode is counted under the key "null", as the JavaScript did). Sums are
-- exact numeric; the JavaScript summed floats.

-- Revenue straight from the rows: totals by category, payment mode, IST day and branch,
-- and payouts by type, for created_at in [p_from, p_to]. get_revenue calls
-- report_revenue (section B), which uses the daily summary and this for what it lacks.
CREATE OR REPLACE FUNCTION public.report_revenue_live(p_branch_ids uuid[], p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH t AS (
    SELECT category::text AS category, coalesce(payment_mode::text, 'null') AS mode, branch_id,
           (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day, amount
      FROM transactions
     WHERE branch_id = ANY (p_branch_ids) AND created_at >= p_from AND created_at <= p_to
  ), p AS (
    SELECT payout_type, amount FROM payouts
     WHERE branch_id = ANY (p_branch_ids) AND created_at >= p_from AND created_at <= p_to
  )
  SELECT jsonb_build_object(
    'byCategory',    coalesce((SELECT jsonb_object_agg(category, s) FROM (SELECT category, sum(amount) s FROM t GROUP BY 1) x), '{}'),
    'byPaymentMode', coalesce((SELECT jsonb_object_agg(mode, s) FROM (SELECT mode, sum(amount) s FROM t GROUP BY 1) x), '{}'),
    'byDay',         coalesce((SELECT jsonb_object_agg(day::text, s) FROM (SELECT day, sum(amount) s FROM t GROUP BY 1) x), '{}'),
    'byBranch',      coalesce((SELECT jsonb_object_agg(branch_id::text, s) FROM (SELECT branch_id, sum(amount) s FROM t GROUP BY 1) x), '{}'),
    'payouts',       coalesce((SELECT jsonb_object_agg(payout_type, s) FROM (SELECT payout_type, sum(amount) s FROM p GROUP BY 1) x), '{}')
  );
$$;

-- get_daily_report over [p_from, p_to]: walk-ins and new memberships by created_at
-- (counts: the Reports page only shows how many), attendance by start_time as
-- distinct students (in total, per booking type, per branch, per IST day), new
-- memberships per IST day, and memberships still valid on p_today.
CREATE OR REPLACE FUNCTION public.report_daily(p_branch_ids uuid[], p_from timestamptz, p_to timestamptz, p_today date)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH rb AS (
    SELECT student_id, booking_type::text AS booking_type, branch_id, (start_time AT TIME ZONE 'Asia/Kolkata')::date AS day
      FROM bookings
     WHERE branch_id = ANY (p_branch_ids) AND start_time >= p_from AND start_time <= p_to
  ), am AS (
    SELECT branch_id FROM memberships
     WHERE branch_id = ANY (p_branch_ids) AND is_active AND end_date >= p_today
  ), nm AS (
    SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day FROM memberships
     WHERE branch_id = ANY (p_branch_ids) AND created_at >= p_from AND created_at <= p_to
  ), per_branch AS (
    SELECT b.id, b.name,
           (SELECT count(DISTINCT student_id) FROM rb WHERE rb.branch_id = b.id) AS total,
           (SELECT count(*) FROM am WHERE am.branch_id = b.id) AS active
      FROM branches b WHERE b.id = ANY (p_branch_ids)
  )
  SELECT jsonb_build_object(
    'walkinCount', (SELECT count(*) FROM bookings WHERE branch_id = ANY (p_branch_ids) AND booking_type = 'walkin'
                      AND created_at >= p_from AND created_at <= p_to),
    'newMemberCount', (SELECT count(*) FROM nm),
    'attendance', (SELECT jsonb_build_object(
        'temporary', count(DISTINCT student_id) FILTER (WHERE booking_type = 'temporary'),
        'permanent', count(DISTINCT student_id) FILTER (WHERE booking_type = 'permanent'),
        'walkin',    count(DISTINCT student_id) FILTER (WHERE booking_type = 'walkin'),
        'total',     count(DISTINCT student_id)) FROM rb),
    'activeMemberships', (SELECT count(*) FROM am),
    'byBranch', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'total', total, 'activeMemberships', active)
                            ORDER BY total DESC, name, id)
                          FROM per_branch WHERE total > 0 OR active > 0), '[]'),
    'attendanceByDay', coalesce((SELECT jsonb_object_agg(day::text, n) FROM (SELECT day, count(DISTINCT student_id) n FROM rb GROUP BY day) x), '{}'),
    'newMembersByDay', coalesce((SELECT jsonb_object_agg(day::text, n) FROM (SELECT day, count(*) n FROM nm GROUP BY day) x), '{}')
  );
$$;

-- get_top_students for a period: sessions and hours per student from p_from on, the
-- top p_limit by visits (or by hours). Ties go to the lower student id (the
-- JavaScript had no defined order for ties).
CREATE OR REPLACE FUNCTION public.report_top_students(p_branch uuid, p_from timestamptz, p_sort text, p_limit int)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(r ORDER BY ord), '[]') FROM (
    SELECT jsonb_build_object('id', s.id, 'name', s.name, 'phone', s.phone, 'course', s.course,
                              'total_visits', count(*), 'total_hours_studied', coalesce(sum(b.hours), 0)) AS r,
           row_number() OVER (ORDER BY CASE WHEN p_sort = 'hours' THEN coalesce(sum(b.hours), 0) ELSE count(*) END DESC, s.id) AS ord
      FROM bookings b JOIN students s ON s.id = b.student_id
     WHERE b.branch_id = p_branch AND b.start_time >= p_from
     GROUP BY s.id
     ORDER BY ord
     LIMIT p_limit
  ) x;
$$;

-- get_referral_stats: students per referral source (all time), and how many have none.
CREATE OR REPLACE FUNCTION public.report_referrals(p_branch_ids uuid[])
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'counts', coalesce((SELECT jsonb_object_agg(src, n) FROM (
        SELECT coalesce(nullif(referral_source, ''), 'unknown') AS src, count(*) n FROM students
         WHERE branch_id = ANY (p_branch_ids) AND referral_source IS NOT NULL GROUP BY 1) x), '{}'),
    'notRecorded', (SELECT count(*) FROM students WHERE branch_id = ANY (p_branch_ids) AND referral_source IS NULL)
  );
$$;

-- list_active_memberships: per student of the active memberships in p_branch_ids,
-- the unbilled Pay Later overtime (sum) and every pending cashback (list, by id).
CREATE OR REPLACE FUNCTION public.active_member_dues(p_branch_ids uuid[])
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH st AS (SELECT DISTINCT student_id FROM memberships WHERE is_active AND branch_id = ANY (p_branch_ids))
  SELECT jsonb_build_object(
    'overtime', coalesce((SELECT jsonb_object_agg(student_id, due) FROM (
        SELECT o.student_id, coalesce(sum(o.billed_amount), 0) AS due FROM overtime_sessions o JOIN st USING (student_id)
         WHERE o.billed_at IS NULL AND o.excluded = false GROUP BY o.student_id) x), '{}'),
    'cashbacks', coalesce((SELECT jsonb_object_agg(student_id, list) FROM (
        SELECT c.student_id, jsonb_agg(jsonb_build_object('cashback_type', c.cashback_type, 'cashback_value', c.cashback_value) ORDER BY c.id) AS list
          FROM cashbacks c JOIN st USING (student_id) WHERE c.status = 'pending' GROUP BY c.student_id) x), '{}')
  );
$$;

-- get_dashboard: every count the dashboard shows for one branch, in one call.
-- p_from / p_to are the IST day's bounds, p_today its date.
CREATE OR REPLACE FUNCTION public.dashboard_counts(p_branch uuid, p_today date, p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'free',     (SELECT count(*) FROM desks WHERE branch_id = p_branch AND status = 'free'),
    'occupied', (SELECT count(*) FROM desks WHERE branch_id = p_branch AND status = 'occupied'),
    'reserved', (SELECT count(*) FROM desks WHERE branch_id = p_branch AND status = 'reserved'),
    'desks',    (SELECT count(*) FROM desks WHERE branch_id = p_branch),
    'active',    (SELECT count(*) FROM memberships WHERE branch_id = p_branch AND is_active AND end_date >= p_today),
    'pending',   (SELECT count(*) FROM memberships WHERE branch_id = p_branch AND is_active AND fee_due > 0),
    'temporary', (SELECT count(*) FROM memberships WHERE branch_id = p_branch AND is_active AND category = 'temporary' AND end_date >= p_today),
    'permanent', (SELECT count(*) FROM memberships WHERE branch_id = p_branch AND is_active AND category = 'permanent' AND end_date >= p_today),
    'currentlyStudying', (SELECT count(*) FROM bookings WHERE branch_id = p_branch AND status = 'active' AND is_paused = false
                            AND created_at >= p_from AND created_at <= p_to),
    'checkedInToday',    (SELECT count(*) FROM bookings WHERE branch_id = p_branch AND start_time >= p_from AND start_time <= p_to)
  );
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['report_revenue_live(uuid[], timestamptz, timestamptz)', 'report_daily(uuid[], timestamptz, timestamptz, date)',
      'report_top_students(uuid, timestamptz, text, int)', 'report_referrals(uuid[])', 'active_member_dues(uuid[])',
      'dashboard_counts(uuid, date, timestamptz, timestamptz)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

-- Indexes for these reports and the busiest lists at 20,000 students and years of rows.
CREATE INDEX IF NOT EXISTS idx_bookings_branch_start ON public.bookings (branch_id, start_time);
CREATE INDEX IF NOT EXISTS idx_memberships_active_branch_end ON public.memberships (branch_id, end_date) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_memberships_active_due ON public.memberships (branch_id) WHERE is_active AND fee_due > 0;
CREATE INDEX IF NOT EXISTS idx_memberships_branch_created ON public.memberships (branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_membership ON public.transactions (membership_id);
CREATE INDEX IF NOT EXISTS idx_food_bills_unpaid_student ON public.food_bills (student_id) WHERE paid = false;
CREATE INDEX IF NOT EXISTS idx_food_bills_branch_created ON public.food_bills (branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_branch_pending ON public.alerts (branch_id, due_date) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_alerts_student_type ON public.alerts (student_id, alert_type, status);
CREATE INDEX IF NOT EXISTS idx_cashbacks_branch_created ON public.cashbacks (branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_students_branch_sno ON public.students (branch_id, s_no);

-- ── B. Daily revenue summary: rebuilt nightly, today live, corrections at once ──
-- Totals per branch, IST day, category and payment mode (payouts per type). Days
-- before revenue_daily_state.complete_before come from here; later days (today, and
-- yesterday until the nightly run) are summed live from the rows. A payment or
-- payout added, edited or deleted on an already-summed day rebuilds that one branch
-- and day at once (trigger), so the summary is never stale; the nightly full rebuild
-- is the safety net. Per day, not per month, because the revenue page draws a daily
-- trend; a month is the sum of its days.
CREATE TABLE IF NOT EXISTS public.revenue_daily (
  branch_id uuid NOT NULL,
  day date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('txn', 'payout')),
  category text NOT NULL,       -- transaction category, or payout type
  payment_mode text NOT NULL,   -- transaction payment mode; '' for payouts
  amount numeric NOT NULL,
  row_count integer NOT NULL,
  PRIMARY KEY (branch_id, day, kind, category, payment_mode)
);
ALTER TABLE public.revenue_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.revenue_daily FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.revenue_daily_state (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  complete_before date,         -- every IST day before this one is in revenue_daily
  refreshed_at timestamptz
);
INSERT INTO public.revenue_daily_state (id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE public.revenue_daily_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.revenue_daily_state FROM anon, authenticated;

-- One branch and IST day, rebuilt from the rows.
CREATE OR REPLACE FUNCTION public.refresh_revenue_day(p_branch uuid, p_day date)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM revenue_daily WHERE branch_id = p_branch AND day = p_day;
  INSERT INTO revenue_daily (branch_id, day, kind, category, payment_mode, amount, row_count)
  SELECT p_branch, p_day, 'txn', category::text, coalesce(payment_mode::text, 'null'), sum(amount), count(*)
    FROM transactions
   WHERE branch_id = p_branch
     AND created_at >= (p_day::timestamp AT TIME ZONE 'Asia/Kolkata')
     AND created_at < ((p_day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
   GROUP BY category, payment_mode
  UNION ALL
  SELECT p_branch, p_day, 'payout', payout_type, '', sum(amount), count(*)
    FROM payouts
   WHERE branch_id = p_branch
     AND created_at >= (p_day::timestamp AT TIME ZONE 'Asia/Kolkata')
     AND created_at < ((p_day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
   GROUP BY payout_type;
$$;

-- Full rebuild of every day before today (IST), in one transaction. The lock blocks
-- only writes to the summary (a correction waits, then rebuilds its day); reports keep
-- reading the previous summary until this commits.
CREATE OR REPLACE FUNCTION public.refresh_revenue_summary()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_rows bigint;
BEGIN
  LOCK TABLE revenue_daily IN EXCLUSIVE MODE;
  DELETE FROM revenue_daily;
  INSERT INTO revenue_daily (branch_id, day, kind, category, payment_mode, amount, row_count)
  SELECT branch_id, (created_at AT TIME ZONE 'Asia/Kolkata')::date, 'txn', category::text, coalesce(payment_mode::text, 'null'), sum(amount), count(*)
    FROM transactions WHERE created_at < (v_today::timestamp AT TIME ZONE 'Asia/Kolkata')
   GROUP BY 1, 2, 4, 5
  UNION ALL
  SELECT branch_id, (created_at AT TIME ZONE 'Asia/Kolkata')::date, 'payout', payout_type, '', sum(amount), count(*)
    FROM payouts WHERE created_at < (v_today::timestamp AT TIME ZONE 'Asia/Kolkata')
   GROUP BY 1, 2, 4;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  UPDATE revenue_daily_state SET complete_before = v_today, refreshed_at = now() WHERE id = 1;
  RETURN format('%s summary rows, complete before %s', v_rows, v_today);
END;
$$;

-- Keeps already-summed days exact when a row of such a day is added, edited or deleted.
-- Rows written today (almost all) only cost the one state lookup.
CREATE OR REPLACE FUNCTION public.revenue_daily_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cb date;
  v_old date;
  v_new date;
BEGIN
  SELECT complete_before INTO v_cb FROM revenue_daily_state WHERE id = 1;
  IF v_cb IS NULL THEN RETURN NULL; END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old := (OLD.created_at AT TIME ZONE 'Asia/Kolkata')::date;
    IF v_old < v_cb THEN PERFORM refresh_revenue_day(OLD.branch_id, v_old); END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new := (NEW.created_at AT TIME ZONE 'Asia/Kolkata')::date;
    IF v_new < v_cb AND NOT (TG_OP = 'UPDATE' AND NEW.branch_id = OLD.branch_id AND v_new = v_old) THEN
      PERFORM refresh_revenue_day(NEW.branch_id, v_new);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER trg_revenue_daily_transactions
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.revenue_daily_touch();
CREATE OR REPLACE TRIGGER trg_revenue_daily_payouts
  AFTER INSERT OR UPDATE OR DELETE ON public.payouts
  FOR EACH ROW EXECUTE FUNCTION public.revenue_daily_touch();

-- get_revenue: summary days plus live rows, the same jsonb as report_revenue_live. Only
-- whole IST days can come from the summary; any other range is summed live.
CREATE OR REPLACE FUNCTION public.report_revenue(p_branch_ids uuid[], p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_cb date;
  v_from_day date := (p_from AT TIME ZONE 'Asia/Kolkata')::date;
  v_to_day date := (p_to AT TIME ZONE 'Asia/Kolkata')::date;
  v_live_from timestamptz;
  v_result jsonb;
BEGIN
  SELECT complete_before INTO v_cb FROM revenue_daily_state WHERE id = 1;
  IF v_cb IS NULL
     OR p_from <> (v_from_day::timestamp AT TIME ZONE 'Asia/Kolkata')
     OR p_to <> ((v_to_day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') - interval '1 microsecond' THEN
    RETURN report_revenue_live(p_branch_ids, p_from, p_to);
  END IF;
  v_live_from := greatest(p_from, (v_cb::timestamp AT TIME ZONE 'Asia/Kolkata'));
  WITH t AS (
    SELECT category, payment_mode AS mode, branch_id, day, amount FROM revenue_daily
     WHERE kind = 'txn' AND branch_id = ANY (p_branch_ids) AND day >= v_from_day AND day <= v_to_day AND day < v_cb
    UNION ALL
    SELECT category::text, coalesce(payment_mode::text, 'null'), branch_id, (created_at AT TIME ZONE 'Asia/Kolkata')::date, amount
      FROM transactions
     WHERE branch_id = ANY (p_branch_ids) AND created_at >= v_live_from AND created_at <= p_to
  ), p AS (
    SELECT category AS payout_type, amount FROM revenue_daily
     WHERE kind = 'payout' AND branch_id = ANY (p_branch_ids) AND day >= v_from_day AND day <= v_to_day AND day < v_cb
    UNION ALL
    SELECT payout_type, amount FROM payouts
     WHERE branch_id = ANY (p_branch_ids) AND created_at >= v_live_from AND created_at <= p_to
  )
  SELECT jsonb_build_object(
    'byCategory',    coalesce((SELECT jsonb_object_agg(category, s) FROM (SELECT category, sum(amount) s FROM t GROUP BY 1) x), '{}'),
    'byPaymentMode', coalesce((SELECT jsonb_object_agg(mode, s) FROM (SELECT mode, sum(amount) s FROM t GROUP BY 1) x), '{}'),
    'byDay',         coalesce((SELECT jsonb_object_agg(day::text, s) FROM (SELECT day, sum(amount) s FROM t GROUP BY 1) x), '{}'),
    'byBranch',      coalesce((SELECT jsonb_object_agg(branch_id::text, s) FROM (SELECT branch_id, sum(amount) s FROM t GROUP BY 1) x), '{}'),
    'payouts',       coalesce((SELECT jsonb_object_agg(payout_type, s) FROM (SELECT payout_type, sum(amount) s FROM p GROUP BY 1) x), '{}')
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- ── E. No duplicates ───────────────────────────────────────────────────────
-- Idempotency: a write sent twice with the same key (a double click, a retried
-- request) runs once; the second gets the first one's stored answer. Per staff
-- member, so keys of different people can never collide. Kept 7 days.
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  staff_id uuid NOT NULL,
  key text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 100),
  action text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done')),
  response_status integer,
  response_body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (staff_id, key)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created ON public.idempotency_keys (created_at);
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.idempotency_keys FROM anon, authenticated;

-- One open session per student, and one per desk, enforced by the database, so two
-- check-ins at the same moment cannot both succeed. Each index is created only if the
-- existing rows already obey it; otherwise this migration skips it with a warning
-- naming the number of conflicts (sort those out, then run this file again).
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM (SELECT student_id FROM bookings WHERE status = 'active'
                                GROUP BY student_id HAVING count(*) > 1) x;
  IF n = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_one_open_per_student ON public.bookings (student_id) WHERE status = 'active';
  ELSE
    RAISE WARNING 'uq_bookings_one_open_per_student NOT created: % students have more than one open session', n;
  END IF;
  SELECT count(*) INTO n FROM (SELECT desk_id FROM bookings WHERE status = 'active' AND desk_id IS NOT NULL
                                GROUP BY desk_id HAVING count(*) > 1) x;
  IF n = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_one_open_per_desk ON public.bookings (desk_id) WHERE status = 'active' AND desk_id IS NOT NULL;
  ELSE
    RAISE WARNING 'uq_bookings_one_open_per_desk NOT created: % desks have more than one open session', n;
  END IF;
END $$;

-- Old rows of the hardening tables. Called nightly with the summary rebuild.
CREATE OR REPLACE FUNCTION public.purge_scale_tables()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_login bigint; v_keys bigint;
BEGIN
  DELETE FROM login_failures WHERE failed_at < now() - interval '1 day';
  GET DIAGNOSTICS v_login = ROW_COUNT;
  DELETE FROM idempotency_keys WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS v_keys = ROW_COUNT;
  RETURN format('%s old login failures and %s old idempotency keys removed', v_login, v_keys);
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['refresh_revenue_day(uuid, date)', 'refresh_revenue_summary()', 'report_revenue(uuid[], timestamptz, timestamptz)',
      'purge_scale_tables()', 'revenue_daily_touch()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['report_revenue(uuid[], timestamptz, timestamptz)', 'refresh_revenue_summary()'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

-- Nightly at 02:00 IST (pg_cron runs on UTC): rebuild the summary, purge old rows.
-- Scheduling by name replaces an existing job of that name, so re-running is safe.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('pss-nightly-summary', '30 20 * * *',
  'SELECT public.refresh_revenue_summary(); SELECT public.purge_scale_tables();');
-- First fill, so the summary is in use straight away.
SELECT public.refresh_revenue_summary();
