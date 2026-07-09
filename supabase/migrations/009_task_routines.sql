-- 009_task_routines.sql  ·  Run this in Supabase SQL Editor
-- Pre-built task templates ("routines") that can be quickly assigned as tasks

CREATE TABLE IF NOT EXISTS task_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  created_by_staff_id UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE task_templates ENABLE ROW LEVEL SECURITY;
