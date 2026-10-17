// Test-only in-memory stand-in for @supabase/supabase-js, so the REAL edge function handler can be
// exercised end-to-end without a database. Implements the subset of the PostgREST query builder the
// handler uses. State lives on globalThis.__FAKE_DB__ so the test script can seed and inspect it.
// deno-lint-ignore-file no-explicit-any

type Row = Record<string, any>;
const g = globalThis as any;
g.__FAKE_DB__ ??= { tables: {} as Record<string, Row[]>, log: [] as string[] };
export const fake = g.__FAKE_DB__ as { tables: Record<string, Row[]>; log: string[] };

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
  membership_holds: { resumed_at: null, days_paused: 0 },
  waivers: {},
  signup_requests: { claimed_by_staff_id: null, claimed_at: null },
};

function uuid() { return crypto.randomUUID(); }
// events has a BIGSERIAL id and occurred_at (migration 052), so it takes no uuid from the seeded counter.
function baseRow(table: string): Row {
  if (table === "events") return { id: tbl(table).reduce((m, r) => Math.max(m, r.id), 0) + 1, occurred_at: new Date().toISOString() };
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
      if (emb[3]) { fk = emb[3]; }
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
  };
}
