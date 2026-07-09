-- 014_enquiries.sql — Enquiries / leads pipeline (no revenue tracking)
-- Walk-in / phone / referral enquiries staff log manually, worked through a
-- new → contacted → converted → dropped funnel, ahead of becoming a student.

CREATE TABLE IF NOT EXISTS enquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  source TEXT NOT NULL DEFAULT 'walk_in',
  message TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'converted', 'dropped')),
  converted_student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  created_by_staff_id UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enquiries_branch ON enquiries(branch_id);
CREATE INDEX IF NOT EXISTS idx_enquiries_status ON enquiries(status);
CREATE INDEX IF NOT EXISTS idx_enquiries_created_at ON enquiries(created_at);

-- Activity log (notes, calls, whatsapp, status changes, merge snapshots)
CREATE TABLE IF NOT EXISTS enquiry_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id UUID NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- note, call, email, whatsapp, status_change, merged_snapshot
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enquiry_activities_enquiry ON enquiry_activities(enquiry_id);

-- Follow-up tasks
CREATE TABLE IF NOT EXISTS enquiry_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id UUID NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  done BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enquiry_followups_enquiry ON enquiry_followups(enquiry_id);
CREATE INDEX IF NOT EXISTS idx_enquiry_followups_branch_open ON enquiry_followups(branch_id, done, due_at);
