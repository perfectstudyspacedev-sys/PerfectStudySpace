// Loads the REAL api edge function with an in-memory stand-in for Supabase (see fake-supabase.ts)
// and exposes call()/seed helpers. No Docker or network database needed: run `npm run test:server`.
// deno-lint-ignore-file no-explicit-any
import { fake } from "./fake-supabase.ts";
import { SignJWT } from "npm:jose@5";

Deno.env.set("JWT_SECRET", "test-secret");
Deno.env.set("STUDENT_JWT_SECRET", "student-test-secret");
Deno.env.set("SUPABASE_URL", "http://fake.local");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake");
Deno.env.set("PUBLIC_SITE_KEY", "site-key");

let handler: ((req: Request) => Promise<Response>) | null = null;
Object.defineProperty(Deno, "serve", { value: (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown() {}, ref() {}, unref() {}, addr: {} }; }, configurable: true, writable: true });
await import(new URL("../../supabase/functions/api/index.ts", import.meta.url).href);
if (!handler) throw new Error("handler not captured");

export { fake };
export async function tokenFor(staff: any, expires?: unknown) {
  // Only a string like "7d" counts — tokenFor is often used as a .map() callback (2nd arg = index).
  const exp = typeof expires === "string" ? expires : "1h";
  return await new SignJWT({ sub: staff.id, role: staff.role, username: staff.username })
    .setProtectedHeader({ alg: "HS256" }).setExpirationTime(exp).sign(new TextEncoder().encode("test-secret"));
}
export async function call(action: string, payload: any = {}, token?: string) {
  const res = await handler!(new Request("http://fn.local/api", {
    method: "POST", headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, ...payload }),
  }));
  const body = await res.json();
  return { status: res.status, ...body };
}
/** Sends a raw Request straight to the api function (for header-level checks such as CORS). */
export async function raw(req: Request) { return await handler!(req); }
export function reset() { for (const k of Object.keys(fake.tables)) delete fake.tables[k]; fake.log.length = 0; for (const k of Object.keys(fake.storage ?? {})) delete fake.storage[k]; }
export function rows(t: string) { return (fake.tables[t] ??= []); }
export function insert(t: string, r: any) { const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r }; rows(t).push(row); return row; }
export const IST_TODAY = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
export function addDays(d: string, n: number) { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }

let fails = 0;
export function check(cond: any, msg: string, extra?: any) {
  if (!cond) fails++;
  console.log(`${cond ? "ok  " : "FAIL"} - ${msg}${cond || extra === undefined ? "" : `  →  ${JSON.stringify(extra)}`}`);
}
export function done() { console.log(fails ? `\n${fails} FAILED` : "\nall passed"); if (fails) Deno.exit(1); }
