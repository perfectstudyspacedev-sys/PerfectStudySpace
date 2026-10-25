// PSS-AI Phase 4 against the REAL api function: SP16 food ordering and the fulfilment queue (D10),
// I20 stock taken off linked inventory, I21 demand forecast and supplier drafts, I22/SP17 tickets,
// and C17 photo-proof housekeeping tasks.
// deno-lint-ignore-file no-explicit-any
import "./determinism.ts";
import { call, insert, rows, reset, tokenFor, check, done, IST_TODAY, addDays, fake } from "./harness.ts";
import { REGISTRY } from "../../supabase/functions/api/actions.ts";
import { runAction } from "../../supabase/functions/api/run.ts";
import { adminClient } from "../../supabase/functions/_shared/auth.ts";

const setSetting = (key: string, value: string) => {
  const hit = rows("app_settings").find((r) => r.key === key);
  if (hit) hit.value = value; else insert("app_settings", { key, value });
};
const run = async (job: string) => await (await runAction(REGISTRY.get(job)!, { db: adminClient(), req: new Request("http://x"), action: job, actor: { type: "system", id: null } }, {})).json();
// A 1×1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let b1: any, b2: any, owner: any, priya: any, ravi: any, tO: string, tP: string, tR: string;
let arun: any, tA: string, tea: any, samosa: any, juice: any, other: any, teaStock: any;
async function setup() {
  reset();
  const TODAY = IST_TODAY();
  b1 = insert("branches", { name: "Hopes", is_active: true });
  b2 = insert("branches", { name: "Ram Nagar", is_active: true });
  owner = insert("staff", { username: "owner", display_name: "Owner", role: "owner", is_active: true, branch_id: null });
  priya = insert("staff", { username: "priya", display_name: "Priya", role: "staff", is_active: true, branch_id: b1.id });
  ravi = insert("staff", { username: "ravi", display_name: "Ravi", role: "staff", is_active: true, branch_id: b2.id });
  [tO, tP, tR] = await Promise.all([owner, priya, ravi].map((s) => tokenFor(s)));
  arun = insert("students", { name: "Arun Kumar", phone: "9100000002", branch_id: b1.id, status: "active", total_visits: 0 });
  insert("memberships", { student_id: arun.id, branch_id: b1.id, category: "temporary", seat_type: "floating", hours_per_day: 12, start_date: addDays(TODAY, -10), end_date: addDays(TODAY, 20), due_date: addDays(TODAY, 21), monthly_fee: 1200, total_paid: 1200, fee_due: 0, is_active: true, is_paused: false });
  teaStock = insert("inventory_items", { branch_id: b1.id, name: "Tea packets", quantity: 10, supplier_phone: null });
  tea = insert("food_items", { branch_id: b1.id, name: "Tea", price: 10, quantity: null, is_active: true, inventory_item_id: null, inventory_per_unit: 1 });
  samosa = insert("food_items", { branch_id: b1.id, name: "Samosa", price: 15, quantity: 5, is_active: true, inventory_item_id: null, inventory_per_unit: 1 });
  juice = insert("food_items", { branch_id: b1.id, name: "Juice", price: 30, quantity: 0, is_active: true, inventory_item_id: null, inventory_per_unit: 1 });
  other = insert("food_items", { branch_id: b2.id, name: "Coffee", price: 12, quantity: null, is_active: true, inventory_item_id: null, inventory_per_unit: 1 });
  setSetting("pssai_portal", "on");
  const code = await call("create_portal_setup_code", { studentId: arun.id }, tP);
  tA = (await call("me_set_pin", { phone: arun.phone, code: code.code, pin: "482915", acceptPrivacy: true })).token;
}
const checkIn = () => call("check_in_member", { branchId: b1.id, studentId: arun.id }, tP);

// ── SP16: ordering in the portal ──
await setup();
{
  check((await call("me_food_menu", {}, tA)).on === false && (await call("me_food_order", { items: [{ foodItemId: tea.id, quantity: 1 }] }, tA)).status === 403, "F1: with pssai_food_orders off there is no menu and no ordering");
  setSetting("pssai_food_orders", "on");
  const menu0 = await call("me_food_menu", {}, tA);
  check(menu0.on && !menu0.canOrder && /Check in first/.test(menu0.whyNot) && menu0.items.find((i: any) => i.name === "Juice").available === false, "F2: before check-in the menu shows but ordering waits; a sold-out item says so", menu0.whyNot);
  check((await call("me_food_order", { items: [{ foodItemId: tea.id, quantity: 1 }] }, tA)).status === 400, "F2: ordering needs an open session (food is brought to the seat)");
  await checkIn();
  const bad = await Promise.all([
    call("me_food_order", { items: [{ foodItemId: tea.id, quantity: 0 }] }, tA),
    call("me_food_order", { items: [{ foodItemId: tea.id, quantity: 11 }] }, tA),
    call("me_food_order", { items: [{ foodItemId: tea.id, quantity: 1 }, { foodItemId: tea.id, quantity: 1 }] }, tA),
    call("me_food_order", { items: [{ foodItemId: other.id, quantity: 1 }] }, tA),
    call("me_food_order", { items: [{ foodItemId: juice.id, quantity: 1 }] }, tA),
    call("me_food_order", { items: [{ foodItemId: samosa.id, quantity: 6 }] }, tA),
  ]);
  check(bad.every((r) => r.status === 400) && rows("food_orders").length === 0, "F3: 0 or 11 of an item, the same item twice, another branch's item, a sold-out item and more than is left are all refused", bad.map((r) => r.error));
  const o = await call("me_food_order", { items: [{ foodItemId: tea.id, quantity: 2, price: 1 }, { foodItemId: samosa.id, quantity: 1 }], note: "  less sugar  ", total: 1 }, tA);
  const row = rows("food_orders")[0];
  check(o.status === 200 && o.order.total === 35 && Number(row.total) === 35 && row.note === "less sugar" && row.items[0].price === 10, "F4: the server prices the order (2 tea + 1 samosa = ₹35); prices sent by the phone are ignored", o);
  check(rows("events").some((e) => e.action === "me_food_order" && e.payload.note === "[14 chars]"), "F4: the note is logged as its length only");
  await call("me_food_order", { items: [{ foodItemId: tea.id, quantity: 1 }] }, tA);
  await call("me_food_order", { items: [{ foodItemId: tea.id, quantity: 1 }] }, tA);
  check((await call("me_food_order", { items: [{ foodItemId: tea.id, quantity: 1 }] }, tA)).status === 429, "F5: a fourth open order waits until one arrives");

  // ── The fulfilment queue ──
  check((await call("list_food_orders", { branchId: b1.id }, tR)).status === 403, "Q1: another branch's staff can't see the queue");
  const q = await call("list_food_orders", { branchId: b1.id }, tP);
  check(q.orders.length === 3 && q.orders[0].student === "Arun Kumar" && q.orders[0].stillCheckedIn, "Q1: the queue lists open orders, oldest first, with the student", q.orders[0]);
  const id = o.order.id;
  check((await call("update_food_order", { orderId: id, status: "delivered" }, tP)).status === 400, "Q2: 'delivered' only happens through delivery (which bills)");
  await call("update_food_order", { orderId: id, status: "accepted" }, tP);
  check((await call("me_cancel_food_order", { orderId: id }, tA)).status === 400, "Q2: an accepted order can't be cancelled by the student");
  await call("update_food_order", { orderId: id, status: "ready" }, tP);
  check(rows("food_orders")[0].status === "ready" && rows("portal_notifications").some((n) => n.kind === "food" && /ready/.test(n.title)), "Q2: ready tells the student");
  check((await call("update_food_order", { orderId: id, status: "accepted" }, tP)).status === 400, "Q2: an order can't go back from ready to accepted");

  // Delivery bills it once: Food Pass covers it.
  const pass = insert("food_passes", { student_id: arun.id, branch_id: b1.id, balance: 100 });
  const [d1, d2] = await Promise.all([call("deliver_food_order", { orderId: id }, tP), call("deliver_food_order", { orderId: id }, tP)]);
  check([d1, d2].filter((r) => r.status === 200).length === 1 && rows("food_bills").length === 1, "Q3: two people delivering the same order at once make one bill", [d1.status, d2.status]);
  const bill = rows("food_bills")[0];
  check(Number(bill.total) === 35 && bill.paid === true && Number(pass.balance) === 65 && rows("food_orders")[0].food_bill_id === bill.id && Number(samosa.quantity) === 4,
    "Q3: create_food_bill runs unchanged: ₹35 from the Food Pass (₹65 left), the samosa count goes down", { bill, pass: pass.balance });

  // Price changed since the order: refused, not charged.
  const second = rows("food_orders")[1];
  tea.price = 12;
  const changed = await call("deliver_food_order", { orderId: second.id }, tP);
  check(changed.status === 409 && second.status === "placed" && rows("food_bills").length === 1, "Q4: a price change since the order is refused, never charged", changed.error);
  tea.price = 10;
  // No pass: tab or cash.
  rows("food_passes").splice(0, 1);
  const tab = await call("deliver_food_order", { orderId: second.id }, tP);
  const cash = await call("deliver_food_order", { orderId: rows("food_orders")[2].id, paymentMode: "cash" }, tP);
  check(tab.status === 200 && tab.bill.paid === false && cash.status === 200 && cash.bill.paid === true && rows("transactions").filter((t) => t.category === "food").length === 1,
    "Q5: without a pass the member's order goes on the tab, or is paid in cash (one food transaction)", { tab: tab.bill, cash: cash.bill });
  check((await call("deliver_food_order", { orderId: rows("food_orders")[2].id, paymentMode: "card" }, tP)).status === 400, "Q5: an unknown payment mode is refused");
  const fourth = await call("me_food_order", { items: [{ foodItemId: tea.id, quantity: 1 }] }, tA);
  check((await call("me_cancel_food_order", { orderId: fourth.order.id }, tA)).status === 200 && rows("food_orders").find((x) => x.id === fourth.order.id).status === "cancelled", "Q6: a placed order can be cancelled by the student");
}

// ── I20 stock, I21 forecast and supplier drafts ──
await setup();
{
  check((await call("set_food_item_stock_link", { itemId: tea.id, inventoryItemId: teaStock.id }, tP)).status === 403, "K1: only the owner links menu items to stock");
  const otherStock = insert("inventory_items", { branch_id: b2.id, name: "Milk", quantity: 5 });
  check((await call("set_food_item_stock_link", { itemId: tea.id, inventoryItemId: otherStock.id }, tO)).status === 400, "K1: stock from another branch can't be linked");
  check((await call("set_food_item_stock_link", { itemId: tea.id, inventoryItemId: teaStock.id, perUnit: 1, supplierPhone: "9876543210" }, tO)).status === 200 && tea.inventory_item_id === teaStock.id && teaStock.supplier_phone === "9876543210", "K1: the owner links Tea to Tea packets");
  await call("create_food_bill", { branchId: b1.id, studentId: arun.id, items: [{ foodItemId: tea.id, quantity: 2 }], paymentMode: "cash" }, tP);
  check(Number(teaStock.quantity) === 10, "K2: with pssai_food_stock off a bill leaves stock alone");
  setSetting("pssai_food_stock", "on");
  await call("create_food_bill", { branchId: b1.id, studentId: arun.id, items: [{ foodItemId: tea.id, quantity: 3 }], paymentMode: "cash" }, tP);
  check(Number(teaStock.quantity) === 7 && rows("inventory_logs").some((l) => l.action === "sold" && l.quantity === 3), "K2: on, billing 3 teas takes 3 packets off and logs them as sold", teaStock.quantity);

  // Four weeks of history: 7 teas on the same weekday as tomorrow, 2 on other days.
  rows("food_bills").splice(0); rows("food_bill_items").splice(0);
  const today = IST_TODAY();
  const tomorrowWd = new Date(`${addDays(today, 1)}T00:00:00Z`).getUTCDay();
  for (let i = 1; i <= 28; i++) {
    const d = addDays(today, -i);
    const q = new Date(`${d}T00:00:00Z`).getUTCDay() === tomorrowWd ? 7 : 2;
    const fb = insert("food_bills", { branch_id: b1.id, student_id: arun.id, subtotal: q * 10, total: q * 10, paid: true, created_at: `${d}T06:30:00.000Z` });
    insert("food_bill_items", { food_bill_id: fb.id, food_item_id: tea.id, name: "Tea", price: 10, quantity: q });
  }
  check((await call("get_food_forecast", { branchId: b1.id }, tP)).status === 403, "K3: the forecast is owner-only");
  const fc = await call("get_food_forecast", { branchId: b1.id }, tO);
  const teaF = fc.items.find((i: any) => i.name === "Tea");
  check(teaF.next[0] === 2 && teaF.next[1] === 7 && fc.inventory[0].perDay > 2.5 && fc.inventory[0].perDay < 3, "K3: tomorrow's weekday sold 7 a day, other days 2; today forecasts 2, tomorrow 7", { next: teaF.next, inv: fc.inventory[0] });
  // 3 days: 2 + 7 + 2 = 11 packets × 1.2 = 13.2 → 14; 7 in stock → order 7.
  check(fc.draft.length === 1 && fc.draft[0].need === 14 && fc.draft[0].order === 7 && fc.draft[0].supplierPhone === "9876543210", "K3: the draft covers 3 days × 1.2 minus stock: order 7 packets", fc.draft);
  check((await run("cron_supplier_drafts")).drafted === 1 && rows("supplier_orders").length === 1, "K4: the nightly job writes one draft");
  await run("cron_supplier_drafts");
  check(rows("supplier_orders").length === 1, "K4: a second run refreshes the same draft (one open draft per branch)");
  const so = rows("supplier_orders")[0];
  check((await call("update_supplier_order", { orderId: so.id, status: "received" }, tP)).status === 403, "K5: staff can't mark supplier orders");
  const rec = await call("update_supplier_order", { orderId: so.id, status: "received", received: [{ inventoryItemId: teaStock.id, quantity: 10 }] }, tO);
  check(rec.status === 200 && rec.added === 1 && Number(teaStock.quantity) === 17 && so.status === "received" && rows("inventory_logs").some((l) => l.action === "add" && l.quantity === 10),
    "K5: marking it received adds what arrived (10, corrected by the owner) through add_inventory_item", { rec, qty: teaStock.quantity, so: so.status, logs: rows("inventory_logs") });
  check((await call("update_supplier_order", { orderId: so.id, status: "received" }, tO)).status === 400, "K5: a received order can't be received again");
}

// ── I22/SP17 tickets ──
await setup();
{
  check((await call("me_report_problem", { category: "wifi", details: "Wi-Fi is down" }, tA)).status === 403, "T1: with pssai_tickets off there is no reporting");
  setSetting("pssai_tickets", "on");
  check((await call("me_report_problem", { category: "parking", details: "No space" }, tA)).status === 400, "T1: only the C16 categories");
  const w = await call("me_report_problem", { category: "wifi", details: "Wi-Fi is down since morning" }, tA);
  const fire = await call("me_report_problem", { category: "cleanliness", details: "There is smoke near the switchboard" }, tA);
  const noise = await call("me_report_problem", { category: "noise", details: "Loud phone calls near F2" }, tA);
  check(w.ticket.priority === "high" && fire.ticket.priority === "urgent" && noise.ticket.priority === "normal", "T2: priority by rule: Wi-Fi high, smoke urgent, noise normal", [w.ticket.priority, fire.ticket.priority, noise.ticket.priority]);
  check((await call("me_report_problem", { category: "seat", details: "Chair is broken" }, tA)).status === 429, "T2: a fourth report in a day is refused");
  check(rows("events").some((e) => e.action === "me_report_problem" && /^\[\d+ chars\]$/.test(e.payload.details)), "T2: the text is logged as its length only");
  check((await call("list_tickets", { branchId: b1.id }, tR)).status === 403, "T3: another branch's staff can't see them");
  const list = await call("list_tickets", { branchId: b1.id }, tP);
  check(list.tickets[0].priority === "urgent" && list.tickets[0].student === "Arun Kumar", "T3: urgent first", list.tickets.map((t: any) => t.priority));
  await call("update_ticket", { ticketId: w.ticket.id, status: "resolved", resolution: "Router restarted" }, tP);
  const mine = await call("me_tickets", {}, tA);
  check(mine.tickets.find((t: any) => t.id === w.ticket.id).status === "resolved" && rows("portal_notifications").some((n) => n.kind === "ticket" && n.body === "Router restarted"), "T4: resolving tells the student, with what was done");
  check((await call("update_ticket", { ticketId: w.ticket.id, status: "done" }, tP)).status === 400, "T4: an unknown status is refused");
}

// ── C17 photo-proof tasks ──
await setup();
{
  const off = await call("create_task", { branchId: b1.id, assignedToStaffId: priya.id, title: "Clean the washroom", repeatInterval: "daily" }, tO);
  check(off.tasks[0].needs_photo === false, "P1: with pssai_photo_tasks off no task needs a photo");
  setSetting("pssai_photo_tasks", "on");
  const clean = (await call("create_task", { branchId: b1.id, assignedToStaffId: priya.id, title: "Mop the hall floor", repeatInterval: "daily" }, tO)).tasks[0];
  const cash = (await call("create_task", { branchId: b1.id, assignedToStaffId: priya.id, title: "Count the cash", repeatInterval: "daily" }, tO)).tasks[0];
  const optOut = (await call("create_task", { branchId: b1.id, assignedToStaffId: priya.id, title: "Clean the shelf", repeatInterval: "daily", needsPhoto: false }, tO)).tasks[0];
  check(clean.needs_photo === true && cash.needs_photo === false && optOut.needs_photo === false, "P2: a daily cleaning task needs a photo (C17); others don't; the owner can untick it");
  check((await call("update_task_status", { taskId: clean.id, done: true }, tP)).status === 400 && !rows("task_completions").length, "P3: it can't be ticked without today's photo");
  check((await call("upload_task_photo", { taskId: clean.id, image: { data: PNG } }, tR)).status === 403, "P3: only the assignee (or the owner) adds the photo");
  check((await call("upload_task_photo", { taskId: clean.id, image: { data: "bm90IGFuIGltYWdl" } }, tP)).status === 400, "P3: a file that is not an image is refused");
  const up = await call("upload_task_photo", { taskId: clean.id, image: { data: PNG } }, tP);
  check(up.status === 200 && Object.keys(fake.storage).some((k) => k.startsWith(`task-photos/${b1.id}/${clean.id}/`)) && rows("task_photos").length === 1, "P3: the photo goes to the private bucket", up);
  check((await call("update_task_status", { taskId: clean.id, done: true }, tP)).status === 200 && rows("task_completions").length === 1, "P3: with the photo in, the task is ticked");
  const mine = await call("get_my_tasks_today", {}, tP);
  check(mine.tasks.find((t: any) => t.id === clean.id).photoTaken === true, "P4: the day's list says the photo is in");
  const url = await call("get_task_photo", { taskId: clean.id }, tO);
  check(url.status === 200 && /task-photos/.test(url.url) && (await call("get_task_photo", { taskId: clean.id }, tR)).status === 403, "P4: the owner opens it through a short link; other staff can't");
  check(rows("events").some((e) => e.action === "upload_task_photo" && e.payload.image === "[redacted]"), "P4: the image never reaches the event log");
  rows("task_photos")[0].created_at = new Date(Date.now() - 31 * 86400e3).toISOString();
  const purge = await run("cron_purge_images");
  check(purge.taskPhotos === 1 && !rows("task_photos").length && !Object.keys(fake.storage).some((k) => k.startsWith("task-photos/")), "P5: task photos are removed after 30 days", purge);
}

done();
