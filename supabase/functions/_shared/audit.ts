// Audit trail (PSS-AI P0.5): actor stamping on inserts and the append-only event log.
// deno-lint-ignore-file no-explicit-any

export type ActorType = "public" | "staff" | "owner" | "admin" | "agent" | "student" | "system";
export interface Actor { type: ActorType; id: string | null }

// Tables that record created_by_staff_id; migration 053 adds actor_type, actor_id and run_id.
export const ACTOR_TABLES = new Set([
  "bookings", "food_bills", "memberships", "transactions", "enquiries",
  "permanent_waitlist", "payouts", "inventory_logs", "waivers",
]);

export function withActor<T extends Record<string, unknown>>(row: T, actor: Actor, runId?: string | null) {
  return { ...row, actor_type: actor.type, actor_id: actor.id, run_id: runId ?? null };
}

// The request's database client with withActor applied to every insert into ACTOR_TABLES, so no
// insert site can forget it (the action code itself is unchanged). Everything else passes through.
export function actorDb<DB extends { from: (table: string) => any }>(db: DB, actor: Actor, runId?: string | null): DB {
  const stamp = (row: any) => (row && typeof row === "object" && !("actor_type" in row)) ? withActor(row, actor, runId) : row;
  return new Proxy(db, {
    get(target, prop) {
      if (prop !== "from") {
        // rpc() and the rest run on the real client, never with the proxy as `this`
        const v = Reflect.get(target, prop, target);
        return typeof v === "function" ? v.bind(target) : v;
      }
      return (table: string) => {
        const qb = target.from(table);
        if (!ACTOR_TABLES.has(table)) return qb;
        const insert = qb.insert.bind(qb);
        qb.insert = (values: any, options?: any) => insert(Array.isArray(values) ? values.map(stamp) : stamp(values), options);
        return qb;
      };
    },
  });
}

const SECRET_KEY = /password|pin|aadhaar|photo|image/i;
const MAX_STRING = 1024;

/** Copy of a payload safe to store: secret-looking keys and strings over 1 KB are replaced. */
export function redactPayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[redacted: too deep]";
  if (typeof value === "string") return value.length > MAX_STRING ? `[redacted: ${value.length} chars]` : value;
  if (Array.isArray(value)) return value.map((v) => redactPayload(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : redactPayload(v, depth + 1);
    return out;
  }
  return value;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);

/** Builds the events row for one action call from its payload and response. */
export async function eventRow(
  meta: { name: string; tier: string },
  actor: Actor, runId: string | null | undefined,
  payload: Record<string, unknown>, res: Response,
) {
  let error: string | null = null;
  const ok = res.status < 400;
  if (!ok) {
    try { error = String((await res.clone().json())?.error ?? `HTTP ${res.status}`).slice(0, 1000); }
    catch { error = `HTTP ${res.status}`; }
  }
  return {
    action: meta.name, tier: meta.tier, actor_type: actor.type, actor_id: actor.id, run_id: runId ?? null,
    branch_id: uuidOrNull(payload.branchId), student_id: uuidOrNull(payload.studentId),
    ok, error, payload: redactPayload(payload),
    reason: typeof payload.reason === "string" ? payload.reason.slice(0, 1000) : null,
  };
}

/** Writes one event. A logging failure is reported but never breaks the action's response. */
export async function writeEvent(db: { from: (table: string) => any }, row: Record<string, unknown>) {
  try {
    const { error } = await db.from("events").insert(row);
    if (error) console.error("events insert failed:", error.message, row.action);
  } catch (e) {
    console.error("events insert failed:", e instanceof Error ? e.message : e, row.action);
  }
}
