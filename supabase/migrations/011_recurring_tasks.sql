-- 011_recurring_tasks.sql  ·  Run this in Supabase SQL Editor
-- Replaces the "routines/templates" concept with a repeat option (daily/weekly/monthly)
-- directly on tasks, tracked per-day via task_completions.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repeat_interval TEXT NOT NULL DEFAULT 'none'
  CHECK (repeat_interval IN ('none', 'daily', 'weekly', 'monthly'));

CREATE TABLE IF NOT EXISTS task_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  completion_date DATE NOT NULL DEFAULT CURRENT_DATE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id, completion_date)
);

CREATE INDEX IF NOT EXISTS idx_task_completions_task ON task_completions(task_id);
CREATE INDEX IF NOT EXISTS idx_task_completions_date ON task_completions(completion_date);

ALTER TABLE task_completions ENABLE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS task_templates;
