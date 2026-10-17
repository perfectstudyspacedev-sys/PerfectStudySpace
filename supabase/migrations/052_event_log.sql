-- 052_event_log.sql  (PSS-AI P0.5, F8)
-- One immutable row per mutating action (success or failure), written by the api router. Reads
-- are logged only for agent and student callers (from Phase 1/2). No foreign keys on purpose:
-- the log must survive deletes of the rows it mentions. Payloads are redacted and capped before
-- writing (secrets, strings over 1 KB, at most 8 KB per row; public callers store only a few
-- named fields). Old rows can be removed only through purge_events() below.

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  action TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('T0','T1','T2','T3')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('public','staff','owner','admin','agent','student','system')),
  actor_id UUID,
  run_id UUID,
  branch_id UUID,
  student_id UUID,
  ok BOOLEAN NOT NULL,
  error TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_action_time  ON events (action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_student_time ON events (student_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_actor_time   ON events (actor_type, actor_id, occurred_at DESC);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
-- No policies: only the edge functions' service-role client reads or writes it.

-- Append-only: refuse UPDATE, DELETE and TRUNCATE, for every role including the service role.
-- The one exception is a DELETE made by purge_events(), which sets pss.events_purge for its own
-- transaction only.
CREATE OR REPLACE FUNCTION events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('pss.events_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'events is append-only: % is not allowed', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS events_no_update_delete ON events;
CREATE TRIGGER events_no_update_delete
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION events_append_only();

DROP TRIGGER IF EXISTS events_no_truncate ON events;
CREATE TRIGGER events_no_truncate
  BEFORE TRUNCATE ON events
  FOR EACH STATEMENT EXECUTE FUNCTION events_append_only();

-- Retention: the only way to remove events. Keeps at least 30 days. The owner decides the period
-- (for example SELECT purge_events(INTERVAL '400 days'); from the SQL editor or a cron job).
CREATE OR REPLACE FUNCTION purge_events(older_than INTERVAL) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  removed BIGINT;
BEGIN
  IF older_than < INTERVAL '30 days' THEN
    RAISE EXCEPTION 'purge_events keeps at least 30 days of events';
  END IF;
  PERFORM set_config('pss.events_purge', 'on', true);
  DELETE FROM events WHERE occurred_at < now() - older_than;
  GET DIAGNOSTICS removed = ROW_COUNT;
  PERFORM set_config('pss.events_purge', 'off', true);
  RETURN removed;
END;
$$;
REVOKE ALL ON FUNCTION purge_events(INTERVAL) FROM PUBLIC, anon, authenticated;
