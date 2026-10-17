// P0.5 — event log and actor audit against the REAL handler: one event per mutating action,
// none for reads, failures logged, payloads redacted, inserts into audited tables stamped.
// deno-lint-ignore-file no-explicit-any
import "./determinism.ts";
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays } from "./harness.ts";
import { ACTION_META } from "../../supabase/functions/api/registry.ts";
import { ACTOR_TABLES, redactPayload } from "../../supabase/functions/_shared/audit.ts";
const g = globalThis as any;
const META = new Map(ACTION_META.map((m) => [m.name, m]));
const TODAY = IST_TODAY();

reset();
const b1 = insert("branches", { name: "Hopes", desk_count: 4, locker_capacity: 20, is_active: true, shift_config: ["morning"], signup_code: "abcdefgh2345" });
const owner = insert("staff", { username: "owner", display_name: "Owner", role: "owner", is_active: true, branch_id: null });
const priya = insert("staff", { username: "priya", display_name: "Priya", role: "staff", is_active: true, branch_id: b1.id });
const desks = ["C1", "C2", "C3", "C4"].map((label, i) => insert("desks", { branch_id: b1.id, label, status: "free", sort_order: i }));
for (const [h, fee] of [[3, 35], [6, 60]]) insert("fee_config", { config_type: "walkin", max_hours: h, fee, sort_order: h });
const asha = insert("students", { name: "Asha Rao", phone: "9100000001", branch_id: b1.id, status: "active", total_visits: 3, total_hours_studied: 12 });
insert("memberships", { student_id: asha.id, branch_id: b1.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: addDays(TODAY, -5), end_date: addDays(TODAY, 25), due_date: addDays(TODAY, 25), monthly_fee: 1250, total_paid: 1250, is_active: true });
const tea = insert("food_items", { branch_id: b1.id, name: "Tea", price: 15, is_active: true, quantity: null });
const enq = insert("enquiries", { branch_id: b1.id, name: "Kiran", phone: "9200000001", source: "walk_in", status: "new" });
g.__FAKE_RPC__ = (fn: string, args: any) => {
  if (fn !== "verify_staff_login") return null;
  const s = rows("staff").find((x) => x.username === args.p_username);
  if (!s || args.p_password !== "pw") return { data: [], error: null };
  return { data: [{ id: s.id, username: s.username, role: s.role, display_name: s.display_name, branch_id: s.branch_id, branch_name: null }], error: null };
};
const tO = await tokenFor(owner), tP = await tokenFor(priya);
const B = { branchId: b1.id };
const events = () => rows("events");
const allJson = () => JSON.stringify(events());
const seededRows = new Set([...ACTOR_TABLES].flatMap((t) => rows(t)));

// ── Ten different mutating actions: exactly one event each, with the right action, tier and caller ──
const ten: [string, any, string, any][] = [
  ["create_walkin", { ...B, name: "Walk Two", phone: "9700000001", hours: 3, paymentMode: "cash", deskId: desks[1].id }, tP, priya],
  ["check_in_member", { ...B, studentId: asha.id, deskId: desks[0].id }, tP, priya],
  ["create_food_bill", { ...B, studentName: "Guest", studentPhone: "9800000001", items: [{ foodItemId: tea.id, quantity: 1 }], paymentMode: "upi" }, tP, priya],
  ["add_manual_payment", { studentId: asha.id, date: TODAY, reason: "fine", amount: 50, paymentMode: "cash" }, tO, owner],
  ["add_locker", { studentId: asha.id, branchId: b1.id, lockerNo: "7", paymentMode: "cash" }, tP, priya],
  ["add_inventory_item", { ...B, name: "Milk", addQuantity: 5 }, tO, owner],
  ["create_task", { ...B, assignedToStaffIds: [priya.id], title: "Refill water", repeatInterval: "none", dueDate: TODAY }, tO, owner],
  ["send_message", { ...B, channel: "branch", recipientType: "staff", content: "Hi" }, tP, priya],
  ["create_enquiry", { ...B, name: "Lead", phone: "9200000003", source: "walk_in", message: "Morning?" }, tP, priya],
  ["add_enquiry_activity", { enquiryId: enq.id, type: "call", note: "Spoke" }, tP, priya],
];
for (const [action, payload, token, who] of ten) {
  const before = events().length;
  const r = await call(action, payload, token);
  const added = events().slice(before);
  const e = added[0];
  check(r.status === 200 && added.length === 1 && e.action === action && e.ok === true && e.error === null
    && e.tier === META.get(action)!.tier && e.actor_type === who.role && e.actor_id === who.id && e.run_id === null,
    `E1: ${action} → exactly one event (ok, tier ${META.get(action)!.tier}, ${who.role})`, { r, added });
}
check(new Set(events().map((e) => e.action)).size === 10, "E1: ten different actions logged");
check(events().every((e, i) => e.id === i + 1 && typeof e.occurred_at === "string"), "E1: event ids are serial", events().map((e) => e.id));
{
  const e = events().find((x) => x.action === "check_in_member")!;
  check(e.branch_id === b1.id && e.student_id === asha.id, "E1: branch and student are taken from the payload", e);
  const pay = events().find((x) => x.action === "add_manual_payment")!;
  check(pay.reason === "fine", "E1: the payload's reason is kept in its own column", pay);
}

// ── Actor stamping on the audited tables ──
{
  const audited = [...ACTOR_TABLES].flatMap((t) => rows(t).map((r) => ({ t, r })));
  const viaApi = audited.filter(({ r }) => !seededRows.has(r));
  const tables = new Set(viaApi.map(({ t }) => t));
  check(["bookings", "transactions", "food_bills", "inventory_logs", "enquiries"].every((t) => tables.has(t)),
    "A1: the ten actions inserted into bookings, transactions, food_bills, inventory_logs and enquiries", [...tables]);
  const unstamped = viaApi.filter(({ r }) => !r.actor_type || !r.actor_id || !("run_id" in r));
  check(unstamped.length === 0, "A1: every row they inserted carries actor_type, actor_id and run_id", unstamped);
  const wrong = viaApi.filter(({ r }) => r.created_by_staff_id && r.created_by_staff_id !== r.actor_id);
  check(wrong.length === 0, "A1: actor_id matches created_by_staff_id wherever both are set", wrong);
  const seeded = rows("enquiries").find((r) => r.id === enq.id)!;
  check(!("actor_type" in seeded), "A1: rows not written through the api are left alone (NULL = before this plan)", seeded);
}

// ── Reads, refusals, logins, errors ──
{
  let before = events().length;
  await call("list_branches", B, tO);
  await call("get_dashboard", B, tP);
  await call("list_enquiries", B, tP);
  check(events().length === before, "E2: staff reads write no event");

  await call("list_branches", B);
  await call("no_such_action", {}, tO);
  check(events().length === before, "E2: an unauthorized call or unknown action writes no event (no action ran)");

  const r = await call("check_in_member", { ...B, studentId: asha.id, deskId: desks[0].id }, tP);
  const e = events().at(-1)!;
  check(r.status >= 400 && events().length === before + 1 && e.action === "check_in_member" && e.ok === false && e.error === r.error,
    "E3: a refused mutating action still writes one event, ok=false, with the error", { r, e });

  before = events().length;
  const good = await call("login", { username: "priya", password: "pw" });
  const bad = await call("login", { username: "priya", password: "wrong-secret" });
  const logins = events().slice(before);
  check(good.status === 200 && bad.status === 401 && logins.length === 2 && logins.every((x) => x.action === "login" && x.actor_type === "public" && x.actor_id === null)
    && logins[0].ok === true && logins[1].ok === false, "E4: login success and failure each logged as public", { good, bad, logins });
  check(logins.every((x) => x.payload.password === "[redacted]") && !allJson().includes("wrong-secret") && !/"pw"/.test(allJson()),
    "E4: no password reaches the event payload", logins.map((x) => x.payload));

  const s = await call("public_signup_submit", { code: "abcdefgh2345", name: "Self Signer", phone: "9600000001", emergencyContact: "9600000002", course: "CA", referralSource: "instagram", website: "", aadhaar: "123412341234", photo: "data:image/png;base64,AAAA", pin: "4321" });
  const se = events().at(-1)!;
  check(s.ok && se.action === "public_signup_submit" && se.actor_type === "public" && se.payload.aadhaar === "[redacted]" && se.payload.photo === "[redacted]" && se.payload.pin === "[redacted]"
    && !allJson().includes("123412341234") && !allJson().includes("4321"), "E4: a sign-up leaves no Aadhaar, photo or PIN in any event", se);

  const created = await call("create_staff", { username: "newstaff", password: "secret-9", displayName: "New", role: "staff", branchId: b1.id }, tO);
  check(created.status === 200 && !allJson().includes("secret-9"), "E4: a staff password set by the owner is not logged", events().at(-1));

  before = events().length;
  g.__FAKE_CHECK__ = (table: string) => { if (table === "enquiries") throw new Error("database exploded"); return null; };
  const boom = await call("create_enquiry", { ...B, name: "Lead Two", phone: "9200000004", source: "walk_in" }, tP);
  g.__FAKE_CHECK__ = undefined;
  const be = events().at(-1)!;
  check(boom.status === 500 && boom.error === "database exploded" && events().length === before + 1 && be.ok === false && be.error === "database exploded",
    "E3: an action that throws still answers 500 as before and writes one failed event", { boom, be });

  g.__FAKE_CHECK__ = (table: string) => (table === "events" ? { message: "events table is down" } : null);
  const origError = console.error; const logged: string[] = []; console.error = (...a: unknown[]) => { logged.push(a.join(" ")); };
  const still = await call("create_enquiry", { ...B, name: "Lead Three", phone: "9200000005", source: "walk_in" }, tP);
  console.error = origError; g.__FAKE_CHECK__ = undefined;
  check(still.status === 200 && rows("enquiries").some((r) => r.name === "Lead Three") && logged.some((l) => l.includes("events insert failed")),
    "E5: if the event cannot be written the action still succeeds and the failure is reported", { still, logged });
}

// ── Append-only (fake mirrors the trigger in migration 052; the SQL itself was run on Postgres) ──
{
  const n = events().length;
  const { createClient } = await import("./fake-supabase.ts");
  const db = createClient();
  const u = await db.from("events").update({ ok: true }).eq("id", 1);
  const d = await db.from("events").delete().eq("id", 1);
  check(u.error && d.error && events().length === n, "E6: UPDATE and DELETE on events are refused", { u, d });
}

// ── Redaction rules ──
{
  const r: any = redactPayload({ username: "a", newPassword: "x", staffPin: "1", aadhaarNo: "2", photoUrl: "3", imageData: "4", note: "y".repeat(1025), short: "y".repeat(1024), nested: { list: [{ password: "z" }] }, n: 5 });
  check(r.username === "a" && [r.newPassword, r.staffPin, r.aadhaarNo, r.photoUrl, r.imageData].every((v) => v === "[redacted]")
    && r.note === "[redacted: 1025 chars]" && r.short.length === 1024 && r.nested.list[0].password === "[redacted]" && r.n === 5,
    "R11: secret keys (any case, nested) and strings over 1 KB are redacted", r);
}

done();
