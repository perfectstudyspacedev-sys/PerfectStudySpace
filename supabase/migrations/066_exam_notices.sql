-- 066_exam_notices.sql  (PSS-AI Phase 3: I25 exam radar, I26 win-back, O9 next-exam plans)
-- Exam names and dates read from the public pages chosen in D8 (or entered by the owner when a
-- page can't be read). The AI's readings arrive as suggestions; only confirmed notices drive
-- prices, win-back and next-exam plans. exam_family is the code's match key (e.g. tnpsc-group-4).

CREATE TABLE IF NOT EXISTS exam_notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('tnpsc', 'upsc', 'ssc', 'ibps', 'sbi', 'tnusrb', 'rrb', 'manual')),
  exam_name TEXT NOT NULL CHECK (char_length(exam_name) BETWEEN 2 AND 160),
  exam_family TEXT,
  notified_on DATE,
  apply_by DATE,
  exam_date DATE,
  url TEXT CHECK (url IS NULL OR char_length(url) <= 500),
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'confirmed', 'dismissed')),
  run_id UUID,
  created_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  reviewed_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One row per exam per date from a source (a re-read of the same page adds nothing).
CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_notices_unique ON exam_notices (source, lower(exam_name), COALESCE(exam_date, '1900-01-01'::date));
CREATE INDEX IF NOT EXISTS idx_exam_notices_family ON exam_notices (exam_family, exam_date) WHERE status = 'confirmed';

-- The Send list now carries more than renewal reminders.
ALTER TABLE send_list ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'collections';
ALTER TABLE send_list DROP CONSTRAINT IF EXISTS send_list_kind_check;
ALTER TABLE send_list ADD CONSTRAINT send_list_kind_check CHECK (kind IN ('collections', 'winback', 'next_exam'));

ALTER TABLE exam_notices ENABLE ROW LEVEL SECURITY;
-- No policies: only the edge functions' service-role client reads or writes it.
