// PSS-AI Phase 4 — food (D10, I20, I21, SP16).
//  - SP16 (pssai_food_orders): a checked-in student orders in the portal; the order waits in a
//    queue that a kitchen person, an outside vendor's staff login or the owner can work. Delivering
//    runs create_food_bill unchanged with the order's items, so the Food Pass, the tab and cash/UPI
//    work exactly as at the counter. An order whose prices changed is refused, never charged.
//  - I20 (pssai_food_stock): billing a menu item linked to an inventory item takes its packets off
//    (takeStock, called from create_food_bill) and logs them as 'sold'.
//  - I21: a weekday-average demand forecast (_shared/food.ts) and a nightly supplier order draft per
//    branch for the owner, who sends it by WhatsApp and marks it received (add_inventory_item).
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin, requireBranch } from "../../_shared/auth.ts";
import { featureOn } from "../../_shared/flags.ts";
import { addDays, istDayEnd, istDayStart, toISTDateStr, todayISO } from "../../_shared/dates.ts";
import { notifyStudent } from "../../_shared/notify.ts";
import { forecastDemand, FORECAST_DAYS, FORECAST_WEEKS, LEAD_DAYS, MAX_OPEN_ORDERS, orderLines, supplierDraft } from "../../_shared/food.ts";
import { actionDef } from "../registry-ref.ts";
import { runNested } from "../run.ts";
import { fetchAllRows } from "../lib.ts";
import { experimentVariant } from "./learning.ts";

const me = (ctx: Ctx) => ctx.student!;
const OPEN = ["placed", "accepted", "ready"];
const NEXT: Record<string, string[]> = { placed: ["accepted", "ready", "cancelled"], accepted: ["ready", "cancelled"], ready: ["cancelled"] };
const round2 = (n: number) => Math.round(n * 100) / 100;

async function openMemberSession(db: Ctx["db"], studentId: string) {
  const { data } = await db.from("bookings").select("id, branch_id, desks!desk_id(label)")
    .eq("student_id", studentId).eq("status", "active").in("booking_type", ["temporary", "permanent"])
    .order("start_time", { ascending: false }).limit(1).maybeSingle();
  return data ?? null;
}

/** Current prices of an order's items at a branch; null when an item is gone or inactive. */
async function priced(db: Ctx["db"], branchId: string, lines: { foodItemId: string; quantity: number }[]) {
  const { data } = await db.from("food_items").select("id, name, price, quantity, is_active").in("id", lines.map((l) => l.foodItemId)).eq("branch_id", branchId);
  const byId = new Map((data ?? []).map((f: any) => [f.id, f]));
  const out = [];
  for (const l of lines) {
    const f: any = byId.get(l.foodItemId);
    if (!f || !f.is_active) return null;
    out.push({ foodItemId: f.id, name: f.name, price: Number(f.price), quantity: l.quantity, left: f.quantity == null ? null : Number(f.quantity) });
  }
  return { lines: out, total: round2(out.reduce((s, l) => s + l.price * l.quantity, 0)) };
}

/** I20: take sold packets off linked inventory items. Never throws: a bill is never undone by it. */
export async function takeStock(db: Ctx["db"], branchId: string, lines: { food_item_id: string; quantity: number }[], staffId: string | null) {
  try {
    const ids = [...new Set(lines.map((l) => l.food_item_id))];
    if (!ids.length) return;
    const { data: items } = await db.from("food_items").select("id, inventory_item_id, inventory_per_unit").in("id", ids).not("inventory_item_id", "is", null);
    for (const it of items ?? []) {
      const qty = lines.filter((l) => l.food_item_id === it.id).reduce((s, l) => s + Number(l.quantity), 0) * Number(it.inventory_per_unit ?? 1);
      if (!(qty > 0)) continue;
      // A conditional update, tried up to 3 times, so two bills at the same moment both count.
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data: inv } = await db.from("inventory_items").select("id, quantity").eq("id", it.inventory_item_id).maybeSingle();
        if (!inv) break;
        const { data: done } = await db.from("inventory_items").update({ quantity: Math.max(0, Number(inv.quantity) - qty) })
          .eq("id", inv.id).eq("quantity", inv.quantity).select("id");
        if (done?.length) {
          await db.from("inventory_logs").insert({ inventory_item_id: inv.id, branch_id: branchId, action: "sold", quantity: qty, created_by_staff_id: staffId });
          break;
        }
      }
    }
  } catch (e) {
    console.error("takeStock failed:", e instanceof Error ? e.message : e);
  }
}

/** Quantities sold per menu item per IST date over the forecast window, from food bills. */
async function salesHistory(db: Ctx["db"], branchId: string, from: string) {
  const start = addDays(from, -FORECAST_WEEKS * 7);
  const bills = await fetchAllRows<any>(() => db.from("food_bills").select("id, created_at, food_bill_items(food_item_id, quantity)")
    .eq("branch_id", branchId).gte("created_at", istDayStart(start)).lte("created_at", istDayEnd(addDays(from, -1))).order("id"));
  const sales: { date: string; itemId: string; qty: number }[] = [];
  for (const b of bills) {
    const date = toISTDateStr(b.created_at);
    for (const li of b.food_bill_items ?? []) if (li.food_item_id) sales.push({ date, itemId: li.food_item_id, qty: Number(li.quantity) || 0 });
  }
  return sales;
}

async function draftFor(db: Ctx["db"], branchId: string) {
  const today = todayISO();
  const [{ data: menu }, { data: inventory }, sales] = await Promise.all([
    db.from("food_items").select("id, name, inventory_item_id, inventory_per_unit, is_active").eq("branch_id", branchId),
    db.from("inventory_items").select("id, name, quantity, supplier_phone").eq("branch_id", branchId).order("name"),
    salesHistory(db, branchId, today),
  ]);
  const forecast = forecastDemand(sales, today);
  const links = (menu ?? []).filter((m: any) => m.inventory_item_id && m.is_active)
    .map((m: any) => ({ foodItemId: m.id, inventoryItemId: m.inventory_item_id, perUnit: Number(m.inventory_per_unit ?? 1) }));
  return { menu: menu ?? [], inventory: inventory ?? [], forecast, links, lines: supplierDraft(inventory ?? [], links, forecast) };
}

export function handlers(): Record<string, Handler> {
  return {
    // ─── Student: SP16 ───
    me_food_menu: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      const s = me(ctx);
      if (!(await featureOn(db, "food_orders"))) return json({ on: false });
      const session = await openMemberSession(db, s.id);
      const branchId = session?.branch_id ?? s.branch_id;
      const [{ data: items }, { data: pass }, { data: orders }] = await Promise.all([
        branchId ? db.from("food_items").select("id, name, price, quantity").eq("branch_id", branchId).eq("is_active", true).order("name") : Promise.resolve({ data: [] }),
        db.from("food_passes").select("balance").eq("student_id", s.id).maybeSingle(),
        db.from("food_orders").select("id, items, total, status, note, cancel_reason, created_at, updated_at").eq("student_id", s.id).order("created_at", { ascending: false }).limit(10),
      ]);
      const atHome = !!session && session.branch_id === s.branch_id;
      // Phase 5 (O6): a featured item shows first — a running menu experiment's variant, else the one kept.
      let featured: string | null = null;
      if (branchId) {
        const v = await experimentVariant(db, "menu_feature", branchId, s.id, atHome);
        if (v) featured = v.value;
        else {
          const { data: kept } = await db.from("app_settings").select("value").eq("key", "featured_food_items").maybeSingle();
          try { featured = (JSON.parse(kept?.value ?? "{}") ?? {})[branchId] ?? null; } catch { featured = null; }
        }
      }
      const menu = [...(items ?? [])].sort((a: any, b: any) => (b.id === featured ? 1 : 0) - (a.id === featured ? 1 : 0));
      return json({
        on: true,
        featured,
        canOrder: atHome,
        whyNot: !session ? "Check in first — food is brought to your seat." : !atHome ? "Visiting another branch? Please order at the counter." : null,
        items: menu.map((f: any) => ({ id: f.id, name: f.name, price: Number(f.price), available: f.quantity == null || Number(f.quantity) > 0, left: f.quantity == null ? null : Number(f.quantity), featured: f.id === featured })),
        foodPass: pass ? { balance: Number(pass.balance) } : null,
        orders: (orders ?? []).map((o: any) => ({ id: o.id, items: o.items, total: Number(o.total), status: o.status, note: o.note, cancelReason: o.cancel_reason, at: o.created_at })),
      });
    },

    me_food_order: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const s = me(ctx);
      if (!(await featureOn(db, "food_orders"))) return err("Ordering is not open yet — please order at the counter", 403);
      const lines = orderLines(payload.items);
      if ("error" in lines) return err(lines.error);
      const session = await openMemberSession(db, s.id);
      if (!session) return err("Check in first — food is brought to your seat");
      if (session.branch_id !== s.branch_id) return err("Visiting another branch? Please order at the counter");
      const { count } = await db.from("food_orders").select("*", { count: "exact", head: true }).eq("student_id", s.id).in("status", OPEN);
      if ((count ?? 0) >= MAX_OPEN_ORDERS) return err(`You have ${count} orders on the way — wait for one to arrive first`, 429);
      const p = await priced(db, session.branch_id, lines);
      if (!p) return err("Something in your order is no longer on the menu — refresh and try again");
      const short = p.lines.find((l) => l.left != null && l.quantity > l.left);
      if (short) return err(short.left ? `Only ${short.left} ${short.name} left` : `${short.name} is sold out`);
      const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 200) || null : null;
      const { data: order, error } = await db.from("food_orders").insert({
        branch_id: session.branch_id, student_id: s.id, booking_id: session.id,
        items: p.lines.map(({ left: _left, ...l }) => l), total: p.total, note,
      }).select("id, total, status, created_at").single();
      if (error || !order) return err(error?.message ?? "Could not place the order", 500);
      return json({ ok: true, order: { id: order.id, total: Number(order.total), status: order.status, at: order.created_at } });
    },

    me_cancel_food_order: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { data } = await ctx.db.from("food_orders").update({ status: "cancelled", cancel_reason: "Cancelled by you", updated_at: new Date().toISOString() })
        .eq("id", payload.orderId).eq("student_id", me(ctx).id).eq("status", "placed").select("id");
      if (!data?.length) return err("This order can't be cancelled now — it is already being made");
      return json({ ok: true });
    },

    // ─── The fulfilment queue (kitchen, vendor, vending) ───
    list_food_orders: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!requireBranch(ctx.staff!, payload.branchId)) return err("Branch access denied", 403);
      const on = await featureOn(db, "food_orders");
      let q = db.from("food_orders").select("id, student_id, booking_id, items, total, note, status, cancel_reason, food_bill_id, created_at, updated_at, students(name, phone), bookings(status, desks!desk_id(label))")
        .eq("branch_id", payload.branchId);
      q = payload.view === "done"
        ? q.in("status", ["delivered", "cancelled"]).gte("updated_at", istDayStart(todayISO())).order("updated_at", { ascending: false })
        : q.in("status", OPEN).order("created_at");
      const { data, error } = await q.limit(200);
      if (error) return err(error.message, 500);
      const ids = [...new Set((data ?? []).map((o: any) => o.student_id))];
      const { data: passes } = ids.length ? await db.from("food_passes").select("student_id, balance").in("student_id", ids) : { data: [] };
      const pass = new Map((passes ?? []).map((p: any) => [p.student_id, Number(p.balance)]));
      return json({
        on,
        orders: (data ?? []).map((o: any) => ({
          id: o.id, status: o.status, items: o.items, total: Number(o.total), note: o.note, cancelReason: o.cancel_reason, at: o.created_at,
          student: o.students?.name ?? null, desk: o.bookings?.desks?.label ?? null, stillCheckedIn: o.bookings?.status === "active",
          foodPassBalance: pass.has(o.student_id) ? pass.get(o.student_id) : null, billed: !!o.food_bill_id,
        })),
      });
    },

    update_food_order: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const { data: o } = await db.from("food_orders").select("id, branch_id, student_id, status").eq("id", payload.orderId).maybeSingle();
      if (!o) return err("Order not found", 404);
      if (!requireBranch(ctx.staff!, o.branch_id)) return err("Branch access denied", 403);
      const to = payload.status;
      if (!(NEXT[o.status] ?? []).includes(to)) return err(`An order that is ${o.status} can't be marked ${to}`);
      const reason = to === "cancelled" ? String(payload.reason ?? "").trim().slice(0, 200) || "Not available right now" : null;
      const { data } = await db.from("food_orders").update({ status: to, handled_by_staff_id: ctx.staff!.id ?? null, updated_at: new Date().toISOString(), ...(reason ? { cancel_reason: reason } : {}) })
        .eq("id", o.id).eq("status", o.status).select("id");
      if (!data?.length) return err("Someone else just changed this order — refresh", 409);
      if (to === "ready") await notifyStudent(db, o.student_id, { kind: "food", title: "Your food is ready", body: "It is on its way to your seat.", dedupeKey: `food-ready:${o.id}` });
      if (to === "cancelled") await notifyStudent(db, o.student_id, { kind: "food", title: "Your food order was cancelled", body: reason, dedupeKey: `food-cancel:${o.id}` });
      return json({ ok: true, orderStatus: to });
    },

    deliver_food_order: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { data: o } = await db.from("food_orders").select("id, branch_id, student_id, booking_id, items, total, status").eq("id", payload.orderId).maybeSingle();
      if (!o) return err("Order not found", 404);
      if (!requireBranch(staff, o.branch_id)) return err("Branch access denied", 403);
      if (!OPEN.includes(o.status)) return err(`This order is already ${o.status}`);
      const mode = payload.paymentMode ?? null;
      if (mode !== null && mode !== "cash" && mode !== "upi") return err("Choose cash, UPI, or leave it for the Food Pass or the tab");
      // The counter's rule (create_food_bill): a student with money on a Food Pass pays through it
      // and nothing else — any shortfall is collected at checkout. Cash or UPI taken here as well
      // would charge them twice, so it is refused. An empty pass counts as no pass (skipFoodPass).
      const { data: pass } = await db.from("food_passes").select("balance").eq("student_id", o.student_id).maybeSingle();
      const passUsable = !!pass && Number(pass.balance) > 0;
      if (passUsable && mode !== null) return err("This student pays from their Food Pass — don't take cash or UPI; any shortfall is collected at checkout", 409);
      const lines = (o.items ?? []).map((l: any) => ({ foodItemId: l.foodItemId, quantity: Number(l.quantity) }));
      const p = await priced(db, o.branch_id, lines);
      if (!p) return err("An item in this order is no longer on the menu — cancel the order", 409);
      if (Math.abs(p.total - Number(o.total)) > 0.001) return err(`Prices changed since the order (₹${Number(o.total)} then, ₹${p.total} now) — cancel it and ask the student to order again`, 409);
      // Claimed once: two people delivering the same order can never bill it twice.
      const { data: claimed } = await db.from("food_orders").update({ status: "delivered", handled_by_staff_id: staff.id ?? null, updated_at: new Date().toISOString() })
        .eq("id", o.id).eq("status", o.status).select("id");
      if (!claimed?.length) return err("Someone else just handled this order — refresh", 409);
      const { data: student } = await db.from("students").select("name, phone").eq("id", o.student_id).maybeSingle();
      const ran = await runNested(actionDef("create_food_bill"), ctx, {}, {
        branchId: o.branch_id, studentId: o.student_id, studentName: student?.name ?? null, studentPhone: student?.phone ?? null,
        bookingId: o.booking_id, items: lines, paymentMode: mode, skipFoodPass: !passUsable,
      });
      if (!ran.ok) {
        await db.from("food_orders").update({ status: o.status, updated_at: new Date().toISOString() }).eq("id", o.id).eq("status", "delivered").is("food_bill_id", null);
        return err(ran.body?.error ?? "Could not bill the order", ran.status);
      }
      await db.from("food_orders").update({ food_bill_id: ran.body.bill?.id ?? null }).eq("id", o.id);
      return json({ ok: true, bill: ran.body.bill, foodPassBalance: ran.body.foodPassBalance ?? null, foodPassShortfall: ran.body.foodPassShortfall ?? null });
    },

    // ─── Owner: I20/I21 ───
    set_food_item_stock_link: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      const { data: item } = await db.from("food_items").select("id, branch_id").eq("id", payload.itemId).maybeSingle();
      if (!item) return err("Menu item not found", 404);
      const invId = payload.inventoryItemId ?? null;
      if (invId) {
        const { data: inv } = await db.from("inventory_items").select("id, branch_id").eq("id", invId).maybeSingle();
        if (!inv || inv.branch_id !== item.branch_id) return err("Pick an inventory item from the same branch");
      }
      const per = Number(payload.perUnit ?? 1);
      if (!Number.isInteger(per) || per < 1 || per > 100) return err("Packets per item must be a whole number from 1 to 100");
      await db.from("food_items").update({ inventory_item_id: invId, inventory_per_unit: per }).eq("id", item.id);
      if (typeof payload.supplierPhone === "string" && invId) {
        const phone = payload.supplierPhone.replace(/\D/g, "");
        if (phone && !/^\d{10}$/.test(phone)) return err("Supplier phone must be 10 digits");
        await db.from("inventory_items").update({ supplier_phone: phone || null }).eq("id", invId);
      }
      return json({ ok: true });
    },

    get_food_forecast: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      if (!payload.branchId) return err("Choose a branch");
      const on = await featureOn(db, "food_stock");
      const d = await draftFor(db, payload.branchId);
      const today = todayISO();
      const days = Array.from({ length: FORECAST_DAYS }, (_, i) => addDays(today, i));
      const use = new Map<string, number>();
      for (const l of d.links) {
        const f = d.forecast.get(l.foodItemId);
        if (f) use.set(l.inventoryItemId, (use.get(l.inventoryItemId) ?? 0) + (f.reduce((a, b) => a + b, 0) / FORECAST_DAYS) * l.perUnit);
      }
      return json({
        on, days, weeks: FORECAST_WEEKS, leadDays: LEAD_DAYS,
        items: d.menu.filter((m: any) => m.is_active).map((m: any) => ({
          id: m.id, name: m.name, inventoryItemId: m.inventory_item_id, perUnit: Number(m.inventory_per_unit ?? 1),
          next: d.forecast.get(m.id) ?? days.map(() => 0),
        })),
        inventory: d.inventory.map((i: any) => {
          const perDay = use.get(i.id) ?? 0;
          return { id: i.id, name: i.name, have: Number(i.quantity), perDay: Math.round(perDay * 10) / 10, daysLeft: perDay > 0 ? Math.floor(Number(i.quantity) / perDay) : null, supplierPhone: i.supplier_phone ?? null };
        }),
        draft: d.lines,
      });
    },

    cron_supplier_drafts: async (ctx: Ctx): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!(await featureOn(db, "food_stock"))) return json({ skipped: "pssai_food_stock is off" });
      const { data: branches } = await db.from("branches").select("id").eq("is_active", true);
      let drafted = 0;
      for (const b of branches ?? []) {
        const d = await draftFor(db, b.id);
        if (!d.links.length) continue;
        const { data: open } = await db.from("supplier_orders").select("id").eq("branch_id", b.id).eq("status", "draft").maybeSingle();
        if (open) await db.from("supplier_orders").update({ items: d.lines, updated_at: new Date().toISOString() }).eq("id", open.id).eq("status", "draft");
        else if (d.lines.length) await db.from("supplier_orders").insert({ branch_id: b.id, items: d.lines });
        if (d.lines.length) drafted++;
      }
      return json({ ok: true, drafted });
    },

    list_supplier_orders: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      let q = db.from("supplier_orders").select("id, branch_id, items, status, created_at, updated_at, decided_at, branches(name)")
        .order("created_at", { ascending: false }).limit(50);
      if (payload.branchId) q = q.eq("branch_id", payload.branchId);
      const { data, error } = await q;
      if (error) return err(error.message, 500);
      return json({ orders: (data ?? []).map((o: any) => ({ ...o, branch: o.branches?.name ?? null, branches: undefined })) });
    },

    update_supplier_order: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      if (!isOwnerOrAdmin(ctx.staff!)) return err("Owner only", 403);
      const { data: o } = await db.from("supplier_orders").select("id, branch_id, items, status").eq("id", payload.orderId).maybeSingle();
      if (!o) return err("Supplier order not found", 404);
      const to = payload.status;
      const allowed: Record<string, string[]> = { draft: ["sent", "received", "discarded"], sent: ["received", "discarded"] };
      if (!(allowed[o.status] ?? []).includes(to)) return err(`A ${o.status} order can't be marked ${to}`);
      const { data: claimed } = await db.from("supplier_orders").update({ status: to, decided_by_staff_id: ctx.staff!.id, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", o.id).eq("status", o.status).select("id");
      if (!claimed?.length) return err("This order was just changed — refresh", 409);
      let added = 0;
      if (to === "received") {
        // The owner can correct what actually arrived; otherwise the drafted quantities are added.
        const got = new Map<string, number>((Array.isArray(payload.received) ? payload.received : []).map((r: any) => [r.inventoryItemId, Number(r.quantity)]));
        for (const line of o.items ?? []) {
          const qty = got.has(line.inventoryItemId) ? got.get(line.inventoryItemId)! : Number(line.order);
          if (!(qty > 0)) continue;
          const ran = await runNested(actionDef("add_inventory_item"), ctx, {}, { branchId: o.branch_id, name: line.name, addQuantity: Math.floor(qty) });
          if (ran.ok) added++;
        }
      }
      return json({ ok: true, orderStatus: to, added });
    },
  };
}
