-- 064_yield_and_leads.sql  (PSS-AI Phase 3: I3 yield pricing, I24 lead scores, AI enquiry
-- dedupe, A2 enquiry chat, A7 exception desk)

-- I3: one walk-in price change per branch per day, inside the owner's floor and ceiling and never
-- outside ±20% of fee_config (C8). Written by the nightly job, or set by the owner by hand.
CREATE TABLE IF NOT EXISTS walkin_price_days (
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  price_date DATE NOT NULL,
  change_pct NUMERIC(5,2) NOT NULL CHECK (change_pct BETWEEN -20 AND 20),
  occupancy NUMERIC(5,4),
  reason TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'owner')),
  set_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, price_date)
);

-- I24: chance of converting, 0–100, with the reason in words.
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS score NUMERIC(5,1);
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS score_reason TEXT;
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ;

-- AI duplicate suggestions for pairs the page's same-phone grouping misses. Merging uses the
-- existing merge dialog; deleting either enquiry removes the suggestion.
CREATE TABLE IF NOT EXISTS enquiry_dedupe (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  enquiry_a UUID NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  enquiry_b UUID NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('same', 'different', 'unsure')),
  confidence NUMERIC(4,3),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'merged', 'dismissed')),
  run_id UUID,
  decided_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enquiry_dedupe_order CHECK (enquiry_a < enquiry_b),
  CONSTRAINT enquiry_dedupe_pair UNIQUE (enquiry_a, enquiry_b)
);
CREATE INDEX IF NOT EXISTS idx_enquiry_dedupe_open ON enquiry_dedupe (branch_id, status);

-- A2: the public enquiry chat. The visitor's browser keeps a random key; only its hash is
-- stored. Rate limits count messages per chat, per phone and per daily-salted IP hash (the IP
-- itself is never stored).
CREATE TABLE IF NOT EXISTS enquiry_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id UUID NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS enquiry_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES enquiry_chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('visitor', 'assistant', 'staff')),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'draft', 'discarded')),
  ip_hash TEXT,
  run_id UUID,
  sent_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_enquiry_chat_messages_chat ON enquiry_chat_messages (chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_enquiry_chat_messages_ip ON enquiry_chat_messages (ip_hash, created_at) WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enquiry_chat_messages_recent ON enquiry_chat_messages (created_at) WHERE role = 'visitor';

-- A7: the exception desk's drafted recommendation. The owner still decides.
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS ai_note JSONB;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS ai_note_at TIMESTAMPTZ;

ALTER TABLE walkin_price_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE enquiry_dedupe ENABLE ROW LEVEL SECURITY;
ALTER TABLE enquiry_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE enquiry_chat_messages ENABLE ROW LEVEL SECURITY;
-- No policies: only the edge functions' service-role client reads or writes them.
