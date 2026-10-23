// Test-only in-memory stand-in for @supabase/supabase-js, so the REAL edge function handler can be
// exercised end-to-end without a database. Implements the subset of the PostgREST query builder the
// handler uses. State lives on globalThis.__FAKE_DB__ so the test script can seed and inspect it.
// deno-lint-ignore-file no-explicit-any

type Row = Record<string, any>;
const g = globalThis as any;
g.__FAKE_DB__ ??= { tables: {} as Record<string, Row[]>, log: [] as string[], storage: {} as Record<string, { bytes: Uint8Array; contentType: string }> };
export const fake = g.__FAKE_DB__ as { tables: Record<string, Row[]>; log: string[]; storage: Record<string, { bytes: Uint8Array; contentType: string }> };

const DEFAULTS: Record<string, Row> = {
  memberships: { is_active: true, is_paused: false, hold_days: 0, fee_due: 0, total_paid: 0, discount_percent: 0, months_paid: 1, timings: "", paused_at: null, hours_per_day_weekend: null, renewed_from_membership_id: null, plan_amount: null, plan_days: null, desk_id: null, cabin_no: null, payment_mode: null },
  transactions: { notes: null, student_id: null, booking_id: null, membership_id: null, food_bill_id: null, locker_id: null },
  payouts: { notes: null },
  cashbacks: { status: "pending", redeemed_membership_id: null, redeemed_amount: null, redeemed_at: null, notes: null },
  overtime_sessions: { excluded: false, billed_at: null, billed_amount: null, membership_id: null },
  bookings: { status: "active", is_paused: false, paused_at: null, total_pause_minutes: 0, membership_id: null, desk_id: null },
  lockers: { is_active: true, deposit_returned: false, amount_paid: 0, fee_due: 0, deposit_amount: 100, monthly_fee: 100 },
  students: { status: "pending", total_visits: 0, total_hours_studied: 0, course: null, emergency_contact: null, referral_source: null },
  alerts: { status: "pending" },
  food_bills: { paid: false, discount_amount: 0 },
  membership_holds: { resumed_at: null, days_paused: 0, planned_resume_date: null, requested_by_student: false },
  waivers: {},
  signup_requests: { claimed_by_staff_id: null, claimed_at: null, pin_hash: null, keep_until: null, id_photo_path: null, id_check: null, pay_key_hash: null },
  // PSS-AI Phase 2 (058–062)
  student_credentials: { failed_attempts: 0, locked_until: null, privacy_accepted_at: null },
  student_setup_codes: { attempts: 0 },
  student_sessions: { revoked_at: null },
  payment_proofs: { status: "requested", request: {}, student_id: null, signup_request_id: null, utr: null, image_path: null, ai_reading: null, checks: null, submitted_at: null, decided_by_staff_id: null, decided_at: null, reject_reason: null, transaction_ids: null },
  portal_notifications: { body: null, action_url: null, dedupe_key: null, read_at: null },
  portal_chat_messages: { status: "sent", reply_to: null, run_id: null, sent_by_staff_id: null, sent_at: null },
  send_list: { status: "pending", amount: null, run_id: null, handled_by_staff_id: null, handled_at: null },
  approvals: { status: "pending", action: null, run_id: null, student_id: null, branch_id: null, decided_by_staff_id: null, decided_at: null, reason: null, result: null, requested_by_id: null },
  student_requests: { status: "pending", details: {}, approval_id: null, decided_at: null },
  permanent_waitlist: { status: "waiting", student_id: null, offered_at: null, offer_expires_at: null, offer_status: null, hours_per_day: null, notes: null },
};

function uuid() { return crypto.randomUUID(); }
// Tables whose primary key is not a generated id; a second insert with the same key fails like Postgres.
const PRIMARY_KEY: Record<string, string> = { idempotency_keys: "key", focus_ratings: "booking_id", fingerprints: "student_id", student_credentials: "student_id", student_setup_codes: "student_id" };
// events has a BIGSERIAL id and occurred_at (migration 052), so it takes no uuid from the seeded counter.
function baseRow(table: string): Row {
  if (table === "events") return { id: tbl(table).reduce((m, r) => Math.max(m, r.id), 0) + 1, occurred_at: new Date().toISOString() };
  if (table in PRIMARY_KEY) return { created_at: new Date().toISOString() };
  // agent_runs (057) stamps started_at, not created_at.
  if (table === "agent_runs") return { id: uuid(), started_at: new Date().toISOString(), staff_id: null, student_id: null };
  return { id: uuid(), created_at: new Date().toISOString() };
}
function tbl(name: string) { return (fake.tables[name] ??= []); }
const clone = (v: any) => (v == null ? v : JSON.parse(JSON.stringify(v)));

function isTs(v: any) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v); }
function cmp(a: any, b: any) {
  if (a == null || b == null) return NaN;
  if (isTs(a) || isTs(b)) {
    const ta = new Date(a.length === 10 ? a + "T00:00:00Z" : a).getTime();
    const tb = new Date(b.length === 10 ? b + "T00:00:00Z" : b).getTime();
    return ta - tb;
  }
  if (typeof a === "number" || typeof b === "number") return Number(a) - Number(b);
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}
function eqv(a: any, b: any) {
  if (typeof a === "boolean" || typeof b === "boolean") return String(a) === String(b);
  if (a == null || b == null) return false;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return cmp(a, b) === 0;
}

// "a.eq.x,and(b.gte.1,b.lte.2)" — PostgREST logic-tree syntax used by .or()
function splitTop(s: string) {
  const out: string[] = []; let depth = 0; let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function parseCond(expr: string): (r: Row) => boolean {
  expr = expr.trim();
  const m = expr.match(/^(and|or)\((.*)\)$/);
  if (m) {
    const parts = splitTop(m[2]).map(parseCond);
    return m[1] === "and" ? (r) => parts.every((p) => p(r)) : (r) => parts.some((p) => p(r));
  }
  const i1 = expr.indexOf("."); const i2 = expr.indexOf(".", i1 + 1);
  const col = expr.slice(0, i1); const op = expr.slice(i1 + 1, i2); const val = expr.slice(i2 + 1);
  return opFn(col, op, val);
}
function opFn(col: string, op: string, val: any): (r: Row) => boolean {
  // "students.branch_id": a column of the joined row (PostgREST filter on an !inner embed).
  if (col.includes(".")) {
    const [rel, field] = col.split(".");
    const fk = `${SINGULAR[rel] ?? rel.replace(/s$/, "")}_id`;
    const inner = opFn(field, op, val);
    return (r) => { const hit = tbl(rel).find((x) => x.id === r[fk]); return !!hit && inner(hit); };
  }
  switch (op) {
    case "eq": return (r) => eqv(r[col], val);
    case "neq": return (r) => !eqv(r[col], val);
    case "gt": return (r) => cmp(r[col], val) > 0;
    case "gte": return (r) => cmp(r[col], val) >= 0;
    case "lt": return (r) => cmp(r[col], val) < 0;
    case "lte": return (r) => cmp(r[col], val) <= 0;
    case "is": return (r) => (val === null || val === "null" ? r[col] == null : String(r[col]) === String(val));
    case "ilike": {
      const re = new RegExp("^" + String(val).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[%*]/g, ".*") + "$", "i");
      return (r) => re.test(String(r[col] ?? ""));
    }
    default: throw new Error(`fake: unsupported op ${op}`);
  }
}

const SINGULAR: Record<string, string> = { students: "student", branches: "branch", desks: "desk", memberships: "membership", staff: "staff", inventory_items: "inventory_item", food_items: "food_item", food_bills: "food_bill", bookings: "booking", lockers: "locker" };

function parseSelect(cols: string) {
  return splitTop(cols.replace(/\s+/g, " ")).map((c) => c.trim()).filter(Boolean);
}
function project(table: string, row: Row, cols: string): Row {
  const items = parseSelect(cols);
  const out: Row = {};
  for (const it of items) {
    const emb = it.match(/^([a-z_]+)(?::([a-z_]+))?(?:!([a-z_]+))?\((.*)\)$/);
    if (emb) {
      // alias:fk(...)  |  table!fk(...)  |  table(...)
      let key = emb[1]; let target = emb[1]; let fk: string | undefined;
      if (emb[2]) { fk = emb[2]; target = key === "staff" ? "staff" : key; }
      if (emb[3] && emb[3] !== "inner" && emb[3] !== "left") { fk = emb[3]; } // !inner/!left are join hints
      const sub = emb[4] || "*";
      if (!fk) {
        const sing = SINGULAR[target] ?? target.replace(/s$/, "");
        if (`${sing}_id` in row) fk = `${sing}_id`;
        else if (target === "staff") fk = Object.keys(row).find((k) => k.endsWith("staff_id") && row[k]);
      }
      if (fk && fk in row) {
        const hit = tbl(target).find((x) => x.id === row[fk!]);
        out[key] = hit ? project(target, hit, sub) : null;
      } else {
        // one-to-many child rows (e.g. food_bill_items(*))
        const parentFk = `${SINGULAR[table] ?? table.replace(/s$/, "")}_id`;
        out[key] = tbl(target).filter((x) => x[parentFk] === row.id).map((x) => project(target, x, sub));
      }
    } else if (it === "*") Object.assign(out, clone(row));
    else out[it] = clone(row[it] ?? null);
  }
  return out;
}

class Query {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private cols = "*"; private opts: any = {}; private payload: any = null;
  private returning = false; private returnCols = "*";
  private orders: { col: string; asc: boolean }[] = [];
  private lim: number | null = null; private rng: [number, number] | null = null;
  private mode: "many" | "single" | "maybe" = "many"; private upsertOpts: any = null;
  constructor(private table: string) {}
  select(cols = "*", opts: any = {}) { if (this.op === "select") { this.cols = cols; this.opts = opts; } else { this.returning = true; this.returnCols = cols; } return this; }
  insert(p: any) { this.op = "insert"; this.payload = p; return this; }
  update(p: any) { this.op = "update"; this.payload = p; return this; }
  upsert(p: any, o?: any) { this.op = "upsert"; this.payload = p; this.upsertOpts = o ?? {}; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: any) { this.filters.push(opFn(c, "eq", v)); return this; }
  neq(c: string, v: any) { this.filters.push(opFn(c, "neq", v)); return this; }
  gt(c: string, v: any) { this.filters.push(opFn(c, "gt", v)); return this; }
  gte(c: string, v: any) { this.filters.push(opFn(c, "gte", v)); return this; }
  lt(c: string, v: any) { this.filters.push(opFn(c, "lt", v)); return this; }
  lte(c: string, v: any) { this.filters.push(opFn(c, "lte", v)); return this; }
  ilike(c: string, v: any) { this.filters.push(opFn(c, "ilike", v)); return this; }
  is(c: string, v: any) { this.filters.push(opFn(c, "is", v)); return this; }
  in(c: string, arr: any[]) { this.filters.push((r) => arr.some((v) => eqv(r[c], v))); return this; }
  not(c: string, op: string, v: any) { const f = opFn(c, op, v); this.filters.push((r) => !f(r)); return this; }
  or(expr: string) { const f = parseCond(`or(${expr})`); this.filters.push(f); return this; }
  order(col: string, o: { ascending?: boolean } = {}) { this.orders.push({ col, asc: o.ascending !== false }); return this; }
  limit(n: number) { this.lim = n; return this; }
  range(a: number, b: number) { this.rng = [a, b]; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  then(res: (v: any) => any, rej?: (e: any) => any) { return Promise.resolve().then(() => this.exec()).then(res, rej); }

  private match() { return tbl(this.table).filter((r) => this.filters.every((f) => f(r))); }
  private finish(rows: Row[], cols: string, count?: number) {
    for (const o of [...this.orders].reverse()) rows = [...rows].sort((a, b) => { const c = cmp(a[o.col], b[o.col]); return (Number.isNaN(c) ? 0 : c) * (o.asc ? 1 : -1); });
    if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
    if (this.lim != null) rows = rows.slice(0, this.lim);
    const data = rows.map((r) => project(this.table, r, cols));
    if (this.mode === "single") {
      if (data.length !== 1) return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" }, count };
      return { data: data[0], error: null, count };
    }
    if (this.mode === "maybe") {
      if (data.length > 1) return { data: null, error: { message: "multiple rows returned", code: "PGRST116" }, count };
      return { data: data[0] ?? null, error: null, count };
    }
    return { data, error: null, count };
  }
  private exec() {
    fake.log.push(`${this.op} ${this.table}`);
    if (this.op === "select") {
      // Tests may install globalThis.__FAKE_SELECT_ERROR__(table, cols) to make a read fail (e.g. a missing column).
      const selErr = g.__FAKE_SELECT_ERROR__?.(this.table, this.cols);
      if (selErr) return { data: null, error: selErr };
      const rows = this.match();
      if (this.opts?.head) return { data: null, error: null, count: rows.length };
      return this.finish(rows, this.cols, this.opts?.count ? rows.length : undefined);
    }
    if (this.op === "insert" || this.op === "upsert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted: Row[] = [];
      for (const p of list) {
        if (this.op === "upsert" && this.upsertOpts?.onConflict) {
          const keys = String(this.upsertOpts.onConflict).split(",");
          const hit = tbl(this.table).find((r) => keys.every((k) => eqv(r[k], p[k])));
          if (hit) { if (!this.upsertOpts.ignoreDuplicates) Object.assign(hit, clone(p)); continue; }
        }
        const row = { ...baseRow(this.table), ...clone(DEFAULTS[this.table] ?? {}), ...clone(p) };
        const pk = PRIMARY_KEY[this.table];
        if (pk && tbl(this.table).some((r) => r[pk] === row[pk])) {
          return { data: null, error: { message: `duplicate key value violates unique constraint "${this.table}_pkey"`, code: "23505" } };
        }
        const err = g.__FAKE_CHECK__?.(this.table, row);
        if (err) return { data: null, error: typeof err === "string" ? { message: err } : err };
        tbl(this.table).push(row); inserted.push(row);
      }
      if (!this.returning) return { data: null, error: null };
      return this.finish(inserted, this.returnCols);
    }
    if ((this.op === "update" || this.op === "delete") && this.table === "events") {
      // mirrors the append-only trigger in migration 052
      return { data: null, error: { message: `events is append-only: ${this.op.toUpperCase()} is not allowed`, code: "P0001" } };
    }
    if (this.op === "update") {
      const rows = this.match();
      for (const r of rows) Object.assign(r, clone(this.payload));
      if (!this.returning) return { data: null, error: null };
      return this.finish(rows, this.returnCols);
    }
    if (this.op === "delete") {
      const rows = this.match();
      fake.tables[this.table] = tbl(this.table).filter((r) => !rows.includes(r));
      if (!this.returning) return { data: null, error: null };
      return this.finish(rows, this.returnCols);
    }
    throw new Error("fake: unknown op");
  }
}

export function createClient(_url?: string, _key?: string) {
  return {
    from: (t: string) => new Query(t),
    // Tests may install globalThis.__FAKE_RPC__(fn, args) to answer database functions (e.g. a login).
    rpc: (fn: string, args: any) => Promise.resolve(g.__FAKE_RPC__?.(fn, args) ?? (fn === "hash_staff_password" ? { data: "hash", error: null } : { data: null, error: null })),
    // Storage (private buckets): objects kept in fake.storage under "bucket/path".
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, bytes: Uint8Array, opts: any = {}) => {
          const key = `${bucket}/${path}`;
          if (key in fake.storage && !opts.upsert) return Promise.resolve({ data: null, error: { message: "The resource already exists" } });
          fake.storage[key] = { bytes: new Uint8Array(bytes), contentType: opts.contentType ?? "application/octet-stream" };
          return Promise.resolve({ data: { path }, error: null });
        },
        download: (path: string) => {
          const hit = fake.storage[`${bucket}/${path}`];
          return Promise.resolve(hit ? { data: new Blob([hit.bytes], { type: hit.contentType }), error: null } : { data: null, error: { message: "Object not found" } });
        },
        createSignedUrl: (path: string, seconds: number) => Promise.resolve(`${bucket}/${path}` in fake.storage
          ? { data: { signedUrl: `http://fake.local/storage/v1/object/sign/${bucket}/${path}?expires=${seconds}` }, error: null }
          : { data: null, error: { message: "Object not found" } }),
        remove: (paths: string[]) => { for (const p of paths) delete fake.storage[`${bucket}/${p}`]; return Promise.resolve({ data: paths, error: null }); },
      }),
    },
  };
}
