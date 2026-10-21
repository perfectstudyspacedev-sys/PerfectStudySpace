-- 060_portal_notifications.sql  (PSS-AI P2.1, P2.4, P2.5)
-- The student portal's inbox, the concierge chat (A1), and the owner's daily Send list (A4).

CREATE TABLE IF NOT EXISTS portal_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  action_url TEXT,
  -- Jobs that may run more than once (session reminders, renewal notices) set a key, so one
  -- event gives one notice.
  dedupe_key TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT portal_notifications_dedupe UNIQUE (student_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_portal_notifications_student ON portal_notifications (student_id, created_at DESC);

-- Concierge chat. In shadow mode (Appendix F rule 7) the agent's replies are drafts that staff
-- send, edit or discard; the student sees only sent messages.
CREATE TABLE IF NOT EXISTS portal_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('student', 'assistant', 'staff')),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'draft', 'discarded')),
  reply_to UUID REFERENCES portal_chat_messages(id) ON DELETE SET NULL,
  run_id UUID,
  sent_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_portal_chat_student ON portal_chat_messages (student_id, created_at);
CREATE INDEX IF NOT EXISTS idx_portal_chat_drafts ON portal_chat_messages (status, created_at) WHERE status = 'draft';

-- A4: one row per student per day: why they are on the list and the drafted WhatsApp message.
CREATE TABLE IF NOT EXISTS send_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_date DATE NOT NULL,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  amount NUMERIC(10,2),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped')),
  run_id UUID,
  handled_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT send_list_day_student UNIQUE (list_date, student_id)
);
CREATE INDEX IF NOT EXISTS idx_send_list_day ON send_list (list_date, branch_id);

ALTER TABLE portal_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE send_list ENABLE ROW LEVEL SECURITY;
-- No policies: only the edge functions' service-role client reads or writes them.
