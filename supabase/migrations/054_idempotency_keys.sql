-- 054_idempotency_keys.sql  (PSS-AI P0.6, F4)
-- A retried money action (payment, checkout, renewal) sends the same Idempotency-Key header;
-- the api router then answers from the stored response instead of running the action twice.
-- status 0 marks a request still running. 2xx and 4xx answers are stored; 5xx never is.
-- request_hash (SHA-256 of the action and its payload) refuses a key reused for a different
-- request. The cron function deletes keys older than 48 hours (P0.7).

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  actor_id UUID,
  request_hash TEXT,
  status INT NOT NULL,
  response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created ON idempotency_keys (created_at);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
-- No policies: only the edge functions' service-role client reads or writes it.
