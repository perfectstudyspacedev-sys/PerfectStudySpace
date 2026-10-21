// Appendix A part 2: the REAL api function and the real Supabase client against a real Postgres
// (with PostgREST). Two ways to point it at a database:
//  - a local Supabase (`supabase start`): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STAFF_JWT_SECRET;
//  - a bare PostgREST over the migrated database: PSS_IT_REST (PostgREST base URL) and
//    PSS_IT_SERVICE_KEY; a small proxy here serves it under /rest/v1 like Supabase does.
// With neither, every suite prints "skipped" and passes (the plan's rule for machines without a DB).
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { SignJWT } from "npm:jose@5";

const restBase = Deno.env.get("PSS_IT_REST")?.replace(/\/+$/, "");
export const configured = !!restBase || !!(Deno.env.get("SUPABASE_URL") && Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
if (!configured) { console.log("skipped: no database (set PSS_IT_REST/PSS_IT_SERVICE_KEY or SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)"); Deno.exit(0); }

if (restBase) {
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, async (req) => {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/rest/v1/")) return new Response("not here", { status: 404 });
    const target = `${restBase}/${url.pathname.slice("/rest/v1/".length)}${url.search}`;
    const headers = new Headers(req.headers); headers.delete("host");
    const res = await fetch(target, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer() });
    return new Response(res.body, { status: res.status, headers: res.headers });
  });
  Deno.env.set("SUPABASE_URL", `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", Deno.env.get("PSS_IT_SERVICE_KEY") ?? "");
}
const STAFF_SECRET = Deno.env.get("STAFF_JWT_SECRET") ?? "pss-it-staff-secret";
Deno.env.set("STAFF_JWT_SECRET", STAFF_SECRET);
Deno.env.set("STUDENT_JWT_SECRET", Deno.env.get("STUDENT_JWT_SECRET") ?? "pss-it-student-secret");

export const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

let handler: ((req: Request) => Promise<Response>) | null = null;
const realServe = Deno.serve;
Object.defineProperty(Deno, "serve", { value: (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown() {}, ref() {}, unref() {}, addr: {} }; }, configurable: true, writable: true });
await import(new URL("../../supabase/functions/api/index.ts", import.meta.url).href);
Object.defineProperty(Deno, "serve", { value: realServe, configurable: true, writable: true });
if (!handler) throw new Error("api handler not captured");

export async function call(action: string, payload: any = {}, token?: string) {
  const res = await handler!(new Request("http://fn.local/api", {
    method: "POST", headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, ...payload }),
  }));
  return { status: res.status, ...(await res.json()) };
}
export async function tokenFor(staff: any) {
  return await new SignJWT({ sub: staff.id, role: staff.role, username: staff.username })
    .setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(STAFF_SECRET));
}

/** Inserts a row and returns it (throws on a database error, so a bad seed is loud). */
export async function insert(table: string, row: any) {
  const { data, error } = await db.from(table).insert(row).select("*").single();
  if (error) throw new Error(`seed ${table}: ${error.message}`);
  return data;
}
export async function get(table: string, id: string) {
  const { data, error } = await db.from(table).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`read ${table}: ${error.message}`);
  return data;
}
export async function where(table: string, col: string, value: any) {
  const { data, error } = await db.from(table).select("*").eq(col, value);
  if (error) throw new Error(`read ${table}: ${error.message}`);
  return data ?? [];
}

// A run-unique prefix so repeated runs on the same database never collide (phones are unique).
const RUN = String(Date.now()).slice(-5);
let n = 0;
export const phone = () => `9${RUN}${String(++n).padStart(4, "0")}`;
export const IST_TODAY = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
export function addDays(d: string, k: number) { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); }

/** A branch, an owner and a desk member of staff, fresh for each scenario. */
export async function world(name: string) {
  const branch = await insert("branches", { name: `IT ${name} ${RUN}`, is_active: true, desk_count: 4, locker_capacity: 10, shift_config: ["morning"] });
  const owner = await insert("staff", { username: `own_${name}_${RUN}`.slice(0, 40), password_hash: "x", display_name: "Owner", role: "owner", is_active: true });
  const staff = await insert("staff", { username: `stf_${name}_${RUN}`.slice(0, 40), password_hash: "x", display_name: "Desk", role: "staff", is_active: true, branch_id: branch.id });
  return { branch, owner, staff, tO: await tokenFor(owner), tS: await tokenFor(staff) };
}

let fails = 0;
export function check(cond: any, msg: string, extra?: any) {
  if (!cond) fails++;
  console.log(`${cond ? "ok  " : "FAIL"} - ${msg}${cond || extra === undefined ? "" : `  →  ${JSON.stringify(extra)}`}`);
}
export function done() { console.log(fails ? `\n${fails} FAILED` : "\nall passed"); Deno.exit(fails ? 1 : 0); }
