// P0.1 CORS allow-list: only listed websites get an Access-Control-Allow-Origin header back.
// deno-lint-ignore-file no-explicit-any
import { raw, reset, insert, check, done } from "./harness.ts";

const API = "http://fn.local/api";
const preflight = (origin?: string) => raw(new Request(API, { method: "OPTIONS", headers: origin ? { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization, content-type, idempotency-key" } : {} }));
const post = (origin: string | null, body: any) => raw(new Request(API, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) }));

reset();
insert("branches", { name: "Hopes", is_active: true, signup_code: "abcdefgh2345" });
Deno.env.delete("ALLOWED_ORIGINS");

for (const origin of ["https://perfect-study-space.pages.dev", "https://join.perfectstudyspace.in", "https://perfectstudyspace.in", "https://www.perfectstudyspace.in", "http://localhost:5173"]) {
  const r = await preflight(origin);
  check(r.ok && r.headers.get("Access-Control-Allow-Origin") === origin, `preflight from ${origin} is allowed (origin echoed)`, Object.fromEntries(r.headers));
}
const pre = await preflight("https://join.perfectstudyspace.in");
check(/idempotency-key/.test(pre.headers.get("Access-Control-Allow-Headers") ?? "") && /authorization/.test(pre.headers.get("Access-Control-Allow-Headers") ?? ""), "allowed headers include authorization and idempotency-key");
check(pre.headers.get("Vary") === "Origin", "responses vary by Origin (no wrong cached header)");

const evil = await preflight("https://evil.example");
check(evil.headers.get("Access-Control-Allow-Origin") === null, "preflight from an unknown site gets no allow header");
const lookalike = await preflight("https://perfectstudyspace.in.evil.example");
check(lookalike.headers.get("Access-Control-Allow-Origin") === null, "a look-alike domain is not allowed (exact match only)");
check((await preflight("http://perfectstudyspace.in")).headers.get("Access-Control-Allow-Origin") === null, "http:// version of an allowed https site is not allowed");

const okPost = await post("https://join.perfectstudyspace.in", { action: "public_signup_info", code: "abcdefgh2345" });
check(okPost.status === 200 && okPost.headers.get("Access-Control-Allow-Origin") === "https://join.perfectstudyspace.in" && (await okPost.json()).branchName === "Hopes", "a real call from the sign-up site works and carries the allow header");
const evilPost = await post("https://evil.example", { action: "public_signup_info", code: "abcdefgh2345" });
check(evilPost.headers.get("Access-Control-Allow-Origin") === null, "a call from an unknown site carries no allow header (the browser blocks the reply)");
const noOrigin = await post(null, { action: "public_signup_info", code: "abcdefgh2345" });
check(noOrigin.status === 200 && noOrigin.headers.get("Access-Control-Allow-Origin") === null, "server-to-server calls (no Origin) still work");
const errPost = await post("https://perfect-study-space.pages.dev", { action: "list_branches" });
check(errPost.status === 401 && errPost.headers.get("Access-Control-Allow-Origin") === "https://perfect-study-space.pages.dev", "error replies also carry the header, so the app can show the message");

Deno.env.set("ALLOWED_ORIGINS", " https://staff.example.com/ , https://join.perfectstudyspace.in ");
check((await preflight("https://staff.example.com")).headers.get("Access-Control-Allow-Origin") === "https://staff.example.com", "ALLOWED_ORIGINS secret replaces the built-in list (spaces and trailing slash ignored)");
check((await preflight("https://perfect-study-space.pages.dev")).headers.get("Access-Control-Allow-Origin") === null, "a site not in the secret is no longer allowed");
Deno.env.delete("ALLOWED_ORIGINS");
done();
