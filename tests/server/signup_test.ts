// CP4 — SSP self sign-up against the REAL handler: public page, alerts, staff lock, deny, expiry,
// registration consuming the sign-up, link management.
// deno-lint-ignore-file no-explicit-any
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays } from "./harness.ts";
const g = globalThis as any;
let refClash = 0;
// Unique constraints from migration 051 (the fake DB has none of its own).
g.__FAKE_CHECK__ = (table: string, row: any) => {
  if (table !== "signup_requests") return null;
  if (refClash > 0) { refClash--; return { message: "duplicate key value violates unique constraint \"signup_requests_branch_ref_key\"", code: "23505" }; }
  const t = rows("signup_requests");
  if (t.some((r) => r.branch_id === row.branch_id && r.phone === row.phone)) return { message: "dup phone", code: "23505" };
  if (t.some((r) => r.branch_id === row.branch_id && r.ref_code === row.ref_code)) return { message: "dup ref", code: "23505" };
  return null;
};
let branch: any, other: any, owner: any, priya: any, ravi: any, far: any;
let tOwner: string, tPriya: string, tRavi: string, tFar: string;
const CODE = "abcdefgh2345", OTHER_CODE = "zyxwvtsr9876";
async function setup() {
  reset();
  branch = insert("branches", { name: "Hopes", is_active: true, locker_capacity: 10, signup_code: CODE });
  other = insert("branches", { name: "Ram Nagar", is_active: true, locker_capacity: 10, signup_code: OTHER_CODE });
  owner = insert("staff", { username: "own", display_name: "Owner", role: "owner", is_active: true, branch_id: null });
  priya = insert("staff", { username: "priya", display_name: "Priya", role: "staff", is_active: true, branch_id: branch.id });
  ravi = insert("staff", { username: "ravi", display_name: "Ravi", role: "staff", is_active: true, branch_id: branch.id });
  far = insert("staff", { username: "far", display_name: "Far", role: "staff", is_active: true, branch_id: other.id });
  [tOwner, tPriya, tRavi, tFar] = await Promise.all([owner, priya, ravi, far].map(tokenFor));
}
const form = (extra: any = {}) => ({ code: CODE, name: "Ravi Kumar", phone: "9876501234", emergencyContact: "9000000009", course: "UPSC", referralSource: "instagram", ...extra });

// ── Public page ──
await setup();
{
  const bad = await call("public_signup_info", { code: "../etc" });
  const unknown = await call("public_signup_info", { code: "aaaaaaaaaaaa" });
  const ok = await call("public_signup_info", { code: CODE });
  check(bad.status === 404 && unknown.status === 404 && ok.branchName === "Hopes", "S1: link works only with the branch's secret code", { bad, unknown, ok });
  check(Object.keys(ok).join(",") === "status,branchName", "S3: the info call reveals only the branch name", ok);
  for (const [extra, re, label] of [
    [{ name: "Ravi" }, /full name/, "one-word name"],
    [{ phone: "98765" }, /10 digit/, "short phone"],
    [{ emergencyContact: "9876501234" }, /different number/, "emergency = own phone"],
    [{ referralSource: "tv" }, /how you heard/, "unknown source"],
    [{ name: "A " + "b".repeat(90) }, /too long/, "name too long"],
    [{ course: "x".repeat(81) }, /too long/, "course too long"],
  ] as [any, RegExp, string][]) {
    const r = await call("public_signup_submit", form(extra));
    check(r.status === 400 && re.test(r.error), `S2: refuses ${label}`, r);
  }
  check(rows("signup_requests").length === 0 && rows("messages").length === 0, "S2: nothing saved from refused submissions");

  const s = await call("public_signup_submit", form({ name: "  Ravi   Kumar " }));
  const req = rows("signup_requests");
  check(s.ok && /^[0-9A-F]{4}$/.test(s.ref) && req.length === 1 && req[0].ref_code === s.ref && req[0].name === "Ravi Kumar" && req[0].branch_id === branch.id,
    "S3: submit saves one pending sign-up and returns its Ref", { s, req });
  check(Object.keys(s).sort().join(",") === "ok,ref,status", "S3: the reply carries only ok + Ref (no stored data)", s);
  const msg = rows("messages");
  check(msg.length === 1 && msg[0].content === `[new_signup] Ravi Kumar (…1234) · Ref #${s.ref}` && msg[0].branch_id === branch.id && !msg[0].content.includes("9876501234"),
    "N1: tagged popup message for that branch, only last 4 phone digits", msg);
  check(rows("students").length === 0 && rows("memberships").length === 0, "X2: nothing in students/memberships yet");

  const again = await call("public_signup_submit", form({ course: "CA", emergencyContact: "9000000010" }));
  check(again.ok && again.ref === s.ref && rows("signup_requests").length === 1 && rows("signup_requests")[0].course === "CA" && rows("messages").length === 1,
    "C4: resubmission (same phone) updates the waiting entry, same Ref, no second popup", { again, rows: rows("signup_requests") });

  const bot = await call("public_signup_submit", form({ phone: "9000000001", website: "http://spam" }));
  check(bot.ok && rows("signup_requests").length === 1, "X1: hidden anti-bot field → pretends success, saves nothing", bot);

  const wrong = await call("public_signup_submit", form({ code: "aaaaaaaaaaaa", phone: "9000000002" }));
  check(wrong.status === 404 && rows("signup_requests").length === 1, "S1: submit with an invalid link is refused", wrong);

  refClash = 1;
  const clash = await call("public_signup_submit", form({ phone: "9000000003", emergencyContact: "9000000004" }));
  check(clash.ok && rows("signup_requests").length === 2, "C1: a Ref clash just retries with a new Ref", clash);
}
// Active member: same reply to the student, flagged for staff
await setup();
{
  const st = insert("students", { name: "Meena Rao", phone: "9111111111", branch_id: branch.id, status: "active" });
  insert("memberships", { student_id: st.id, branch_id: branch.id, category: "temporary", seat_type: "floating", hours_per_day: 6, start_date: addDays(IST_TODAY(), -5), end_date: addDays(IST_TODAY(), 25), due_date: IST_TODAY(), monthly_fee: 1250, is_active: true });
  const s = await call("public_signup_submit", form({ name: "Meena Rao", phone: "9111111111" }));
  check(s.ok && /^[0-9A-F]{4}$/.test(s.ref), "C4: an existing member gets the same reply (the page can't be used to check who is a member)", s);
  const l = await call("list_signup_requests", { branchId: branch.id }, tPriya);
  check(l.requests.length === 1 && l.requests[0].activeMember?.studentId === st.id && l.requests[0].activeMember.branch === "Hopes", "C4: staff see it flagged as an active member (use Renew)", l.requests[0]);
  const reg = await call("claim_signup_request", { id: l.requests[0].id }, tPriya);
  const cm = await call("create_membership", { branchId: branch.id, name: "Meena Rao", phone: "9111111111", category: "temporary", hoursPerDay: 6, monthsPaid: 1, paymentMode: "cash", emergencyContact: "9000000009", referralSource: "instagram", signupId: l.requests[0].id }, tPriya);
  check(reg.request && cm.status === 400 && /already has an active/.test(cm.error) && rows("signup_requests").length === 1, "C4: registering an active member is still refused by the duplicate guard", cm.error);
}
// Spam limit
await setup();
{
  for (let i = 0; i < 50; i++) insert("signup_requests", { branch_id: branch.id, ref_code: i.toString(16).padStart(4, "0").toUpperCase(), name: "X Y", phone: String(9200000000 + i), emergency_contact: "9000000000", referral_source: "flex" });
  const r = await call("public_signup_submit", form());
  check(r.status === 429 && rows("signup_requests").length === 50, "X1: at most 50 waiting sign-ups per branch", r);
  const o = await call("public_signup_submit", form({ code: OTHER_CODE }));
  check(o.ok, "X1: the limit is per branch", o);
}
// End-of-day expiry
await setup();
{
  const yesterday = new Date(Date.parse(addDays(IST_TODAY(), -1) + "T20:00:00+05:30")).toISOString();
  const earlyToday = new Date(Date.parse(IST_TODAY() + "T00:05:00+05:30")).toISOString();
  insert("signup_requests", { branch_id: branch.id, ref_code: "AAAA", name: "Old One", phone: "9300000001", emergency_contact: "9000000000", referral_source: "flex", created_at: yesterday });
  insert("signup_requests", { branch_id: branch.id, ref_code: "BBBB", name: "New One", phone: "9300000002", emergency_contact: "9000000000", referral_source: "flex", created_at: earlyToday });
  const l = await call("list_signup_requests", { branchId: branch.id }, tPriya);
  check(l.requests.length === 1 && l.requests[0].ref === "BBBB" && rows("signup_requests").length === 1, "A3: yesterday's sign-up is deleted automatically; today's stays", l.requests);
  insert("signup_requests", { branch_id: branch.id, ref_code: "CCCC", name: "Old Two", phone: "9876501234", emergency_contact: "9000000000", referral_source: "flex", created_at: yesterday });
  const s = await call("public_signup_submit", form());
  check(s.ok && s.ref !== "CCCC" && rows("signup_requests").length === 2, "A3: resubmitting after an expired one starts fresh", s);
}
// Lists, lock, release, deny
await setup();
{
  const a = await call("public_signup_submit", form());
  await call("public_signup_submit", form({ code: OTHER_CODE, phone: "9400000001" }));
  const lp = await call("list_signup_requests", { branchId: branch.id }, tPriya);
  const lo = await call("list_signup_requests", { allBranches: true }, tOwner);
  const lfar = await call("list_signup_requests", { branchId: branch.id }, tFar);
  const lsneak = await call("list_signup_requests", { allBranches: true, branchId: branch.id }, tFar);
  check(lp.requests.length === 1 && lp.requests[0].ref === a.ref && lp.requests[0].emergencyContact === "9000000009", "A4: staff see their branch's sign-ups with all 5 details", lp.requests);
  check(lo.requests.length === 2 && lo.requests.some((r: any) => r.branchName === "Ram Nagar"), "A4: owner sees every branch, with branch name", lo.requests.map((r: any) => r.branchName));
  check(lfar.status === 403 && lsneak.status === 403, "A4: staff of another branch can't list this branch's sign-ups", { lfar, lsneak });

  const id = lp.requests[0].id;
  const c1 = await call("claim_signup_request", { id }, tPriya);
  check(c1.request && c1.request.name === "Ravi Kumar" && c1.request.phone === "9876501234" && c1.request.referralSource === "instagram", "A1/C2: Approve takes the lock and returns the details to pre-fill", c1);
  const c2 = await call("claim_signup_request", { id }, tRavi);
  check(c2.status === 409 && /being handled by Priya/.test(c2.error), "C2: a second staff member sees 'being handled by Priya'", c2);
  const lr = await call("list_signup_requests", { branchId: branch.id }, tRavi);
  const lp2 = await call("list_signup_requests", { branchId: branch.id }, tPriya);
  check(lr.requests[0].handledBy === "Priya" && !lr.requests[0].handledByMe && lp2.requests[0].handledByMe, "C2: the list shows who is handling it", { r: lr.requests[0], p: lp2.requests[0] });
  const busy = await call("public_signup_submit", form({ course: "GATE" }));
  check(busy.status === 409 && /processing your details/.test(busy.error) && rows("signup_requests").find((r) => r.id === id).course === "UPSC", "C4: resubmission while staff are on it is refused (details unchanged)", busy);
  const dRavi = await call("deny_signup_request", { id }, tRavi);
  check(dRavi.status === 409 && rows("signup_requests").length === 2, "C3: Deny by someone else while it's being handled is refused", dRavi);
  const relRavi = await call("release_signup_request", { id }, tRavi);
  check(relRavi.ok && rows("signup_requests").find((r) => r.id === id).claimed_by_staff_id === priya.id, "C2: only the holder can release the lock", rows("signup_requests").find((r) => r.id === id));
  const rel = await call("release_signup_request", { id }, tPriya);
  check(rel.ok && rows("signup_requests").find((r) => r.id === id).claimed_by_staff_id === null, "C2: closing the form releases it back to pending", rel);
  await call("claim_signup_request", { id }, tPriya);
  rows("signup_requests").find((r) => r.id === id).claimed_at = new Date(Date.now() - 16 * 60_000).toISOString();
  const lr2 = await call("list_signup_requests", { branchId: branch.id }, tRavi);
  const take = await call("claim_signup_request", { id }, tRavi);
  check(lr2.requests[0].handledBy === null && take.request, "C2: a lock older than 15 minutes is released automatically", { lr2: lr2.requests[0], take });
  const deny = await call("deny_signup_request", { id }, tRavi);
  const deny2 = await call("deny_signup_request", { id }, tPriya);
  check(deny.ok && !rows("signup_requests").some((r) => r.id === id) && deny2.status === 409 && /already handled/.test(deny2.error), "A2/C3: Deny deletes it at once; a second Deny says already handled", deny2);
  const farDeny = await call("deny_signup_request", { id: rows("signup_requests")[0].id }, tPriya);
  check(farDeny.status === 403, "A4: staff can't deny another branch's sign-up", farDeny);
}
// Register from a sign-up
await setup();
{
  const a = await call("public_signup_submit", form());
  const id = rows("signup_requests")[0].id;
  const reg = { branchId: branch.id, name: "Ravi Kumar", phone: "9876501234", category: "temporary", hoursPerDay: 6, monthsPaid: 1, paymentMode: "cash", emergencyContact: "9000000009", referralSource: "instagram", course: "UPSC", signupId: id };
  await call("claim_signup_request", { id }, tPriya);
  const stolen = await call("create_membership", reg, tRavi);
  check(stolen.status === 409 && /being handled by Priya/.test(stolen.error) && rows("students").length === 0 && rows("memberships").length === 0, "C3: Register by someone not holding it is refused before anything is written", stolen);
  const wrongBranch = await call("create_membership", { ...reg, branchId: other.id }, tOwner);
  check(wrongBranch.status === 400 && /another branch/.test(wrongBranch.error) && rows("students").length === 0, "Register: a sign-up can't be registered into a different branch", wrongBranch);
  const ok = await call("create_membership", reg, tPriya);
  check(ok.membership && rows("signup_requests").length === 0 && rows("students").length === 1 && rows("students")[0].emergency_contact === "9000000009", "A1/X2: Register creates the student + membership and removes the sign-up", ok);
  check(rows("transactions").length === 1 && Number(rows("transactions")[0].amount) === 1250, "Register: payment recorded as usual", rows("transactions"));
  const twice = await call("create_membership", reg, tPriya);
  check(twice.status === 409 && /already handled/.test(twice.error) && rows("memberships").length === 1, "C3: registering the same sign-up again is refused", twice);
  const plain = await call("create_membership", { ...reg, phone: "9500000001", name: "Walk In", signupId: undefined }, tPriya);
  check(plain.membership, "Register without a sign-up works exactly as before", plain);
  void a;
}
// Link management
await setup();
{
  branch.signup_code = null;
  const staffFirst = await call("get_signup_link", { branchId: branch.id }, tPriya);
  check(staffFirst.code === null, "X3: staff can't create the link (owner does)", staffFirst);
  const o1 = await call("get_signup_link", { branchId: branch.id }, tOwner);
  const o2 = await call("get_signup_link", { branchId: branch.id }, tOwner);
  const s1 = await call("get_signup_link", { branchId: branch.id }, tPriya);
  check(/^[0-9a-z]{12}$/.test(o1.code) && o2.code === o1.code && s1.code === o1.code, "X3: owner creates the link once; staff can copy the same link", { o1, o2, s1 });
  const farGet = await call("get_signup_link", { branchId: branch.id }, tFar);
  const staffRotate = await call("rotate_signup_link", { branchId: branch.id }, tPriya);
  check(farGet.status === 403 && staffRotate.status === 403, "X3: other-branch staff can't read it; staff can't make a new one", { farGet, staffRotate });
  const rot = await call("rotate_signup_link", { branchId: branch.id }, tOwner);
  const oldInfo = await call("public_signup_info", { code: o1.code });
  const newInfo = await call("public_signup_info", { code: rot.code });
  check(rot.code && rot.code !== o1.code && oldInfo.status === 404 && newInfo.branchName === "Hopes", "X3: 'Make new link' stops the old link at once", { rot, oldInfo, newInfo });
  branch.is_active = false;
  const closed = await call("public_signup_info", { code: rot.code });
  check(closed.status === 404, "S1: a deactivated branch's link stops working", closed);
}
done();
