-- 055_students_page.sql
-- The Students page, one page at a time, computed by the database.
--
-- Since 2b-C the api sent one page of 50, but to cut it out it still loaded EVERY student of
-- the branch scope (20 reads of 1,000 at 20,000 students) plus every active membership and
-- locker, then filtered and sorted them in JavaScript. At 20,000 students that kept the
-- functions container CPU-bound and slowed the other project on the server. Rule from now
-- on: the database returns only the page; filters, search, sorting, the total and the
-- per-branch counts are done in SQL; no whole table goes into a function.
--
-- students_page() gives exactly what the api's filterSortStudents()/filterCombinedStudents()
-- gave (same rows, same fields, same order, same totals, course list and branch counts):
--   * a student's membership / locker = the ACTIVE one in the branch scope with the highest id
--     (the api kept the last of the id-ordered list);
--   * status as computeStudentStatus(); isOverdue / lockerOverdue as before (lockerOverdue is
--     null when the locker has no due date);
--   * sorting as the page's comparator: empty values ("-", "", none) always last, numbers as
--     numbers, text like JavaScript localeCompare(numeric, sensitivity base) through the ICU
--     collation below, equal values in S.No order (the old sort was stable);
--   * Combined Hall: grouped by branch name (localeCompare order), each group in S.No order.
-- Append-only, safe to run twice. Callable by the api (service_role) only.

CREATE COLLATION IF NOT EXISTS public.pss_ui_sort (provider = icu, locale = 'und-u-kn-ks-level1', deterministic = false);

CREATE OR REPLACE FUNCTION public.students_page(
  p_branch_ids uuid[], p_combined boolean, p_today date,
  p_search text, p_status text, p_course text, p_filters jsonb,
  p_sort_key text, p_sort_dir text, p_branch_name text,
  p_page int, p_page_size int, p_export boolean)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
WITH
mem AS (SELECT DISTINCT ON (student_id) * FROM memberships
         WHERE branch_id = ANY (p_branch_ids) AND is_active ORDER BY student_id, id DESC),
lck AS (SELECT DISTINCT ON (student_id) * FROM lockers
         WHERE branch_id = ANY (p_branch_ids) AND is_active ORDER BY student_id, id DESC),
base AS (
  SELECT s.id, row_number() OVER (ORDER BY s.s_no, s.id) AS ord, s.s_no, s.name, s.phone, s.course,
         s.total_visits, s.total_hours_studied, b.name AS branch_name, b.id IS NOT NULL AS has_branch,
         m.id IS NOT NULL AS has_mem, m.cabin_no, m.start_date, m.end_date, m.due_date, m.month,
         m.hours_per_day, m.timings, m.fee_due AS mem_fee,
         l.id IS NOT NULL AS has_lck, l.locker_no, l.locker_due_date, l.fee_due AS lck_fee
    FROM students s
    LEFT JOIN branches b ON b.id = s.branch_id
    LEFT JOIN mem m ON m.student_id = s.id
    LEFT JOIN lck l ON l.student_id = s.id
   WHERE s.branch_id = ANY (p_branch_ids)),
r AS (
  SELECT base.*,
         coalesce(s_no, ord) AS sno,
         CASE WHEN has_mem THEN coalesce(cabin_no, '-') ELSE '-' END AS cabin,
         CASE WHEN has_mem THEN coalesce(start_date::text, '-') ELSE '-' END AS start_t,
         CASE WHEN has_mem THEN coalesce(end_date::text, '-') ELSE '-' END AS end_t,
         CASE WHEN has_mem THEN coalesce(due_date::text, '-') ELSE '-' END AS due_t,
         CASE WHEN has_mem THEN coalesce(month, '-') ELSE '-' END AS month_t,
         CASE WHEN has_mem THEN coalesce(timings, '-') ELSE '-' END AS timings_t,
         CASE WHEN has_mem THEN hours_per_day END AS hours_n,
         CASE WHEN has_lck THEN coalesce(locker_no, '-') ELSE '-' END AS locker_t,
         CASE WHEN has_lck THEN coalesce(locker_due_date::text, '-') ELSE '-' END AS lockerdue_t,
         coalesce(course, '-') AS course_t,
         (has_lck AND ((locker_due_date IS NOT NULL AND locker_due_date < p_today) OR coalesce(lck_fee, 0) > 0)) AS lck_owes
    FROM base),
st AS (
  SELECT r.*,
         CASE WHEN NOT has_mem THEN CASE WHEN has_lck THEN CASE WHEN lck_owes THEN 'pending' ELSE 'active' END ELSE 'inactive' END
              WHEN mem_fee > 0 OR end_date < p_today THEN 'pending'
              WHEN lck_owes THEN 'pending'
              ELSE 'active' END AS status,
         coalesce(branch_name, 'Unknown Branch') AS gname
    FROM r),
q AS (SELECT lower(regexp_replace(coalesce(p_search, ''), '^\s+|\s+$', '', 'g')) AS s),
f AS (  -- search + status (+ course and column filters on the one-branch page)
  SELECT st.* FROM st, q
   WHERE (q.s = '' OR position(q.s IN lower(name)) > 0 OR position(q.s IN coalesce(phone, '')) > 0
          OR position(q.s IN lower(cabin)) > 0)
     AND CASE WHEN p_combined THEN (CASE WHEN coalesce(p_status, '') <> '' THEN status = p_status ELSE status <> 'inactive' END)
              ELSE status = coalesce(p_status, 'active') END
     AND (p_combined OR coalesce(p_course, '') = '' OR course_t = p_course)
     AND (p_combined OR NOT EXISTS (
          SELECT 1 FROM jsonb_each_text(coalesce(p_filters, '{}'::jsonb)) fl(k, v)
           WHERE lower(regexp_replace(coalesce(fl.v, ''), '^\s+|\s+$', '', 'g')) <> ''
             AND position(lower(regexp_replace(fl.v, '^\s+|\s+$', '', 'g')) IN lower(coalesce(
                   CASE fl.k
                     WHEN 'sNo' THEN st.sno::text
                     WHEN 'name' THEN nullif(coalesce(st.name, ''), '-')
                     WHEN 'cabin' THEN nullif(st.cabin, '-')
                     WHEN 'startDate' THEN CASE WHEN st.start_t <> '-' THEN to_char(st.start_t::date, 'DD-MM-YY') || ' ' || st.start_t END
                     WHEN 'endDate' THEN CASE WHEN st.end_t <> '-' THEN to_char(st.end_t::date, 'DD-MM-YY') || ' ' || st.end_t END
                     WHEN 'month' THEN nullif(st.month_t, '-')
                     WHEN 'hours' THEN st.hours_n::text
                     WHEN 'locker' THEN nullif(st.locker_t, '-')
                     WHEN 'lockerDue' THEN CASE WHEN st.lockerdue_t <> '-' THEN to_char(st.lockerdue_t::date, 'DD-MM-YY') || ' ' || st.lockerdue_t END
                     WHEN 'course' THEN nullif(st.course_t, '-')
                     WHEN 'contact' THEN nullif(st.phone, '-')
                   END, ''))) = 0))),
v AS (  -- what the page shows: Combined Hall may pick one branch
  SELECT f.* FROM f WHERE NOT p_combined OR coalesce(p_branch_name, '') = '' OR gname = p_branch_name),
k AS (  -- the sort value of the chosen column: blank / number / text
  SELECT v.*,
    CASE p_sort_key
      WHEN 'sNo' THEN sno::numeric WHEN 'hours' THEN hours_n::numeric
      WHEN 'totalVisits' THEN total_visits::numeric WHEN 'totalHours' THEN total_hours_studied::numeric
      WHEN 'isOverdue' THEN CASE WHEN has_mem AND coalesce(due_date < p_today, false) AND mem_fee > 0 THEN 1 ELSE 0 END
      WHEN 'lockerOverdue' THEN CASE WHEN NOT has_lck THEN 0 WHEN locker_due_date IS NULL THEN NULL WHEN locker_due_date < p_today THEN 1 ELSE 0 END
    END AS snum,
    CASE p_sort_key
      WHEN 'name' THEN name WHEN 'cabin' THEN cabin WHEN 'startDate' THEN start_t WHEN 'endDate' THEN end_t
      WHEN 'dueDate' THEN due_t WHEN 'month' THEN month_t WHEN 'timings' THEN timings_t WHEN 'locker' THEN locker_t
      WHEN 'lockerDue' THEN lockerdue_t WHEN 'course' THEN course_t WHEN 'contact' THEN phone
      WHEN 'status' THEN status WHEN 'id' THEN id::text
    END AS stxt
    FROM v),
o AS (
  SELECT k.*, row_number() OVER (ORDER BY
           CASE WHEN p_combined THEN gname END COLLATE "und-x-icu",
           CASE WHEN p_combined THEN NULL
                WHEN p_sort_key IN ('sNo', 'hours', 'totalVisits', 'totalHours', 'isOverdue', 'lockerOverdue') THEN snum IS NULL
                ELSE stxt IS NULL OR stxt IN ('', '-') END,
           CASE WHEN NOT p_combined AND coalesce(p_sort_dir, 'asc') = 'asc' THEN snum END ASC,
           CASE WHEN NOT p_combined AND coalesce(p_sort_dir, 'asc') <> 'asc' THEN snum END DESC,
           CASE WHEN NOT p_combined AND coalesce(p_sort_dir, 'asc') = 'asc' THEN stxt END COLLATE pss_ui_sort ASC,
           CASE WHEN NOT p_combined AND coalesce(p_sort_dir, 'asc') <> 'asc' THEN stxt END COLLATE pss_ui_sort DESC,
           ord) AS rn
    FROM k),
pg AS (
  SELECT t.total, t.ps, greatest(1, ceil(t.total::numeric / t.ps))::int AS pages FROM (
    SELECT (SELECT count(*) FROM v) AS total, least(200, greatest(1, coalesce(p_page_size, 50))) AS ps) t),
pp AS (SELECT pg.*, least(pg.pages, greatest(1, coalesce(p_page, 1))) AS page FROM pg),
rows_out AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'sNo', o.sno, 'id', o.id, 'name', o.name,
           'branches', CASE WHEN o.has_branch THEN jsonb_build_object('name', o.branch_name) END,
           'cabin', o.cabin, 'startDate', o.start_t, 'endDate', o.end_t, 'dueDate', o.due_t, 'month', o.month_t,
           'hours', CASE WHEN o.hours_n IS NULL THEN to_jsonb('-'::text) ELSE to_jsonb(o.hours_n) END,
           'timings', o.timings_t, 'locker', o.locker_t, 'lockerDue', o.lockerdue_t, 'course', o.course_t,
           'contact', o.phone, 'status', o.status,
           'isOverdue', CASE WHEN o.has_mem THEN coalesce(o.due_date < p_today, false) AND o.mem_fee > 0 ELSE false END,
           'lockerOverdue', CASE WHEN NOT o.has_lck THEN to_jsonb(false) WHEN o.locker_due_date IS NULL THEN 'null'::jsonb
                                 ELSE to_jsonb(o.locker_due_date < p_today) END,
           'totalVisits', o.total_visits, 'totalHours', o.total_hours_studied) ORDER BY o.rn), '[]'::jsonb) AS rows
    FROM o, pp
   WHERE p_export OR (o.rn > (pp.page - 1) * pp.ps AND o.rn <= pp.page * pp.ps))
SELECT CASE WHEN p_export THEN
         jsonb_build_object('students', rows_out.rows, 'totalAll', (SELECT count(*) FROM st))
       ELSE
         jsonb_build_object(
           'rows', rows_out.rows, 'total', pp.total, 'totalAll', (SELECT count(*) FROM st),
           'page', pp.page, 'pages', pp.pages, 'pageSize', pp.ps,
           'courses', CASE WHEN p_combined THEN '[]'::jsonb ELSE coalesce((
               SELECT jsonb_agg(c ORDER BY c COLLATE "C") FROM (SELECT DISTINCT course AS c FROM st
                WHERE course IS NOT NULL AND course <> '' AND course <> '-') cs), '[]'::jsonb) END)
         || CASE WHEN p_combined THEN jsonb_build_object('branchCounts', coalesce((
               SELECT jsonb_agg(jsonb_build_array(g, n) ORDER BY g COLLATE "und-x-icu")
                 FROM (SELECT gname AS g, count(*) AS n FROM f GROUP BY gname) gc), '[]'::jsonb))
            ELSE '{}'::jsonb END
       END
  FROM rows_out, pp
$$;

REVOKE ALL ON FUNCTION public.students_page(uuid[], boolean, date, text, text, text, jsonb, text, text, text, int, int, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.students_page(uuid[], boolean, date, text, text, text, jsonb, text, text, text, int, int, boolean) TO service_role;

-- Indexes for the scope reads (active membership / locker per student in a set of branches).
CREATE INDEX IF NOT EXISTS idx_memberships_active_branch_student ON public.memberships (branch_id, student_id, id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_lockers_active_branch_student ON public.lockers (branch_id, student_id, id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_students_branch_sno ON public.students (branch_id, s_no, id);
