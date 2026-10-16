// Study-report period: get_student_study_report against the REAL handler.
// deno-lint-ignore-file no-explicit-any
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays } from "./harness.ts";
const today = IST_TODAY();
reset();
const hopes = insert("branches", { name: "Hopes", is_active: true });
const other = insert("branches", { name: "Ram Nagar", is_active: true });
const owner = insert("staff", { username: "own", role: "owner", is_active: true, branch_id: null });
const priya = insert("staff", { username: "priya", display_name: "Priya", role: "staff", is_active: true, branch_id: hopes.id });
const far = insert("staff", { username: "far", role: "staff", is_active: true, branch_id: other.id });
const [tO, tP, tF] = await Promise.all([owner, priya, far].map(tokenFor));
const st = insert("students", { name: "Vijayalakshmi S.N", phone: "8778599029", branch_id: hopes.id, status: "active" });
const at = (day: string, hh: string) => new Date(`${day}T${hh}:00+05:30`).toISOString();
const session = (day: string, from = "10:00", to = "12:00", status = "completed") =>
  insert("bookings", { student_id: st.id, branch_id: hopes.id, booking_type: "temporary", status, start_time: at(day, from), end_time: status === "active" ? null : at(day, to) });

// 130 sessions: one per day for the last 130 days — more than the 100 the profile call returns
for (let i = 0; i < 130; i++) session(addDays(today, -i), "09:00", "10:00");
session(addDays(today, -3), "14:00", "15:30");                                // 2nd session same day
session(addDays(today, -3), "16:00", "17:00", "cancelled");                    // cancelled → ignored
const d = (n: number) => addDays(today, -n);

const r = await call("get_student_study_report", { studentId: st.id, dateFrom: d(59), dateTo: d(40) }, tP);
const days = new Set(r.bookings?.map((b: any) => b.start_time.slice(0, 10)));
check(r.bookings?.length === 20 && r.studentName === "Vijayalakshmi S.N", "an older 20-day window (59–40 days ago) returns all 20 sessions — the profile call (latest 100 only) would have lost them", { n: r.bookings?.length, e: r.error });
check(r.bookings.every((b: any) => { const t = Date.parse(b.start_time); return t >= Date.parse(d(59) + "T00:00:00+05:30") && t < Date.parse(addDays(d(40), 1) + "T00:00:00+05:30"); }), "every session is inside the chosen dates");

const recent = await call("get_student_study_report", { studentId: st.id, dateFrom: d(5), dateTo: today }, tP);
check(recent.bookings.length === 7, "last 6 days: 6 daily sessions + the extra same-day session = 7, cancelled one left out", recent.bookings.length);
check(recent.bookings.every((b: any) => b.status !== "cancelled"), "cancelled sessions are not returned");
check(Object.keys(recent.bookings[0]).sort().join() === "end_time,start_time,status", "only start, end and status are returned (no other booking data)", Object.keys(recent.bookings[0]));

const same = await call("get_student_study_report", { studentId: st.id, dateFrom: today, dateTo: today }, tP);
check(same.bookings.length === 1, "one-day period (today to today) works", same);
const edge = await call("get_student_study_report", { studentId: st.id, dateFrom: d(3), dateTo: d(3) }, tP);
check(edge.bookings.length === 2, "a single day with two sessions returns both (cancelled excluded)", edge.bookings.length);

const bad = async (payload: any, re: RegExp, label: string, tok = tP) => { const x = await call("get_student_study_report", { studentId: st.id, ...payload }, tok); check(x.status === (label.includes("branch") ? 403 : 400) && re.test(x.error), label, x); };
await bad({ dateFrom: d(5) }, /start date and an end date/, "missing end date is refused");
await bad({ dateFrom: "2026-13-40", dateTo: today }, /start date and an end date/, "invalid date is refused");
await bad({ dateFrom: today, dateTo: d(2) }, /on or before/, "start after end is refused");
await bad({ dateFrom: d(1), dateTo: addDays(today, 1) }, /future/, "end date in the future is refused");
await bad({ dateFrom: d(60), dateTo: today }, /at most 60 days/, "61 days is refused");
const sixty = await call("get_student_study_report", { studentId: st.id, dateFrom: d(59), dateTo: today }, tP);
check(sixty.status === 200, "exactly 60 days is allowed", sixty.error);
await bad({ dateFrom: d(5), dateTo: today }, /branch access/i, "staff of another branch can't read this student's report (branch)", tF);
const own = await call("get_student_study_report", { studentId: st.id, dateFrom: d(5), dateTo: today }, tO);
check(own.status === 200, "the owner can", own.error);
const nobody = await call("get_student_study_report", { studentId: crypto.randomUUID(), dateFrom: d(5), dateTo: today }, tP);
check(nobody.status === 400 && /not found/i.test(nobody.error), "unknown student → not found", nobody);
const noauth = await call("get_student_study_report", { studentId: st.id, dateFrom: d(5), dateTo: today });
check(noauth.status === 401, "without a staff login it is refused", noauth.status);
done();
