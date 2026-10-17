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

// Whether migration 053 is applied, checked once per function instance. Without its columns every
// stamped insert would fail (and money paths would stop half-way), so stamping is skipped instead.
// A failed check is retried after a minute; a passed one is kept.
let actorColumns: { ok: boolean; at: number; pending?: Promise<boolean> } | null = null;
export function actorColumnsAvailable(db: { from: (table: string) => any }): Promise<boolean> {
  if (actorColumns?.ok) return Promise.resolve(true);
  if (actorColumns?.pending) return actorColumns.pending;
  if (actorColumns && Date.now() - actorColumns.at < 60_000) return Promise.resolve(false);
  const pending = (async () => {
    try {
      const { error } = await db.from("transactions").select("actor_type").limit(1);
      if (error) console.error("actor columns unavailable (is migration 053 applied?) — stamping skipped:", error.message);
      actorColumns = { ok: !error, at: Date.now() };
    } catch (e) {
      console.error("actor column check failed — stamping skipped:", e instanceof Error ? e.message : e);
      actorColumns = { ok: false, at: Date.now() };
    }
    return actorColumns.ok;
  })();
  actorColumns = { ok: false, at: Date.now(), pending };
  return pending;
}
/** Tests only: forget the result of the check above. */
export function resetActorColumnsCheck() { actorColumns = null; }

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

// A key is secret when one of its words is (newPassword, staff_pin, aadhaarNo, photoUrl…) or the
// whole key is (siteKey). Whole words only, so "pincode" or "typing" are kept.
const SECRET_WORDS = new Set(["password", "passwd", "passcode", "pwd", "pin", "aadhaar", "aadhar", "photo", "image", "secret", "token", "otp"]);
const SECRET_KEYS = new Set(["sitekey", "apikey", "authorization"]);
export function isSecretKey(key: string): boolean {
  if (SECRET_KEYS.has(key.toLowerCase())) return true;
  return key.split(/[_\-\s.]+|(?<=[a-z0-9])(?=[A-Z])/).some((w) => SECRET_WORDS.has(w.toLowerCase()));
}

// Size limits, so no request can make the append-only log grow by more than a few KB.
const MAX_STRING = 1024;
const MAX_KEY = 64;
const MAX_KEYS = 50;
const MAX_ITEMS = 50;
export const MAX_PAYLOAD_BYTES = 8192;

/** Copy of a payload safe to store: secret keys and over-long strings, keys, objects and arrays are cut. */
export function redactPayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[redacted: too deep]";
  if (typeof value === "string") return value.length > MAX_STRING ? `[redacted: ${value.length} chars]` : value;
  if (Array.isArray(value)) {
    const kept = value.slice(0, MAX_ITEMS).map((v) => redactPayload(v, depth + 1));
    return value.length > MAX_ITEMS ? [...kept, `[+${value.length - MAX_ITEMS} more]`] : kept;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    let skipped = 0;
    for (const [k, v] of Object.entries(value)) {
      if (k.length > MAX_KEY || Object.keys(out).length >= MAX_KEYS) { skipped++; continue; }
      out[k] = isSecretKey(k) ? "[redacted]" : redactPayload(v, depth + 1);
    }
    if (skipped) out["[skipped keys]"] = skipped;
    return out;
  }
  return value;
}

// Public calls (no login) store only these fields, cut to 100 characters: enough to spot abuse,
// nothing personal. Any other public action stores none.
const PUBLIC_FIELDS: Record<string, string[]> = {
  login: ["username"],
  public_signup_submit: ["referralSource"],
  public_create_enquiry: ["branch", "packageInterest"],
};
function publicPayload(action: string, payload: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_FIELDS[action] ?? []) {
    if (typeof payload[k] === "string") out[k] = (payload[k] as string).slice(0, 100);
  }
  return out;
}

/** The payload as stored: public fields only for public callers, redacted, and at most 8 KB. */
export function storedPayload(action: string, actorType: string, payload: Record<string, unknown>): unknown {
  const safe = actorType === "public" ? publicPayload(action, payload) : redactPayload(payload);
  const bytes = new TextEncoder().encode(JSON.stringify(safe)).length;
  if (bytes <= MAX_PAYLOAD_BYTES) return safe;
  return { truncated: true, bytes, keys: Object.keys(payload).filter((k) => k.length <= MAX_KEY && !isSecretKey(k)).slice(0, 20) };
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
    ok, error, payload: storedPayload(meta.name, actor.type, payload),
    reason: actor.type !== "public" && typeof payload.reason === "string" ? payload.reason.slice(0, 1000) : null,
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
