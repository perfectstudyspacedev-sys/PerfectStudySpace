// Food menu, food bills and inventory. Each handler is an old `if (action === "…") { … }` block from
// api/index.ts, moved unchanged in PSS-AI P0.4; ctx gives it the same db/staff/req/action as before.
// deno-lint-ignore-file no-explicit-any
import type { Ctx, Handler } from "../registry.ts";
import { istDayEnd, istDayStart } from "../../_shared/dates.ts";
import { err, json } from "../../_shared/http.ts";
import { isOwnerOrAdmin, requireBranch } from "../../_shared/auth.ts";
import { recordTransaction } from "../lib.ts";

export function handlers(): Record<string, Handler> {
  const h: Record<string, Handler> = {
    // ─── FOOD ───
    list_food_items: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, allBranches } = payload;
      let q = db.from("food_items").select("*, branches(name)").eq("is_active", true).order("name");
      if (allBranches && isOwnerOrAdmin(staff)) {
        // no branch filter — every branch's menu, for the Combined Hall read-only view
      } else {
        if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
        q = q.eq("branch_id", branchId);
      }
      const { data } = await q;
      return json({ items: data ?? [] });
    },
    create_food_bill: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, studentId, studentName, studentPhone, bookingId, items, paymentMode, discountType, discountValue, discountAmount, skipFoodPass } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (studentId) {
        const { data: billStudent } = await db.from("students").select("branch_id").eq("id", studentId).single();
        if (!billStudent || billStudent.branch_id !== branchId) return err("Student does not belong to this branch", 403);
      }

      let subtotal = 0;
      const lineItems = [];
      for (const item of items) {
        const { data: fi } = await db.from("food_items").select("*").eq("id", item.foodItemId).single();
        if (!fi) continue;
        const qty = item.quantity || 1;
        if (fi.quantity != null && qty > fi.quantity) return err(`Only ${fi.quantity} of ${fi.name} available`);
        subtotal += Number(fi.price) * qty;
        lineItems.push({ food_item_id: fi.id, name: fi.name, price: fi.price, quantity: qty });
        if (fi.quantity != null) await db.from("food_items").update({ quantity: fi.quantity - qty }).eq("id", fi.id);
      }

      // Clamped to [0, subtotal] rather than trusted as sent: a negative discount would
      // *inflate* the bill above the sum of its own line items, and an oversized one would
      // record a discount_amount that doesn't match the total actually charged (total is
      // floored at 0 below, so the two would silently disagree on the receipt).
      const disc = Math.min(Math.max(Number(discountAmount) || 0, 0), subtotal);
      const total = subtotal - disc;

      // A student with a Food Pass pays through it exclusively — not a choice, a rule. The
      // pass balance itself must never go negative: if this order exceeds what's available,
      // the balance is left untouched and the bill is left unpaid, so it shows up in
      // checkout_booking's unpaid-bills query — collection is compulsory there, not here.
      // Exception: a pass with nothing left on it (skipFoodPass, set by the frontend when the
      // balance is 0) isn't usable at all — treated exactly like the student has no pass, so
      // staff get the normal Pay Now / Pay Later choice instead.
      let payFromPass = false;
      let newPassBalance = null;
      let pass = null;
      let passCoversOrder = false;
      if (studentId && !skipFoodPass) {
        const { data: p } = await db.from("food_passes").select("*").eq("student_id", studentId).maybeSingle();
        pass = p;
      }
      if (pass) {
        payFromPass = true;
        passCoversOrder = Number(pass.balance) >= total;
        if (passCoversOrder) {
          newPassBalance = Number(pass.balance) - total;
          await db.from("food_passes").update({
            balance: newPassBalance, updated_at: new Date().toISOString(),
          }).eq("id", pass.id);
        } else {
          newPassBalance = Number(pass.balance);
        }
      }

      // Otherwise: no payment mode ⇒ bill is recorded unpaid, carried on the student's tab
      // (membership students get up to 3 days before it must be settled at checkout).
      const isPaid = (payFromPass && passCoversOrder) || (!payFromPass && paymentMode != null);

      const { data: bill, error } = await db.from("food_bills").insert({
        branch_id: branchId, student_id: studentId, booking_id: bookingId,
        student_name: studentName, student_phone: studentPhone,
        subtotal, discount_type: discountType, discount_value: discountValue ?? 0,
        discount_amount: disc, total,
        payment_mode: passCoversOrder ? "other" : (isPaid ? paymentMode : null), paid: isPaid,
        created_by_staff_id: staff.id,
      }).select("id").single();
      if (error) return err(error.message);

      for (const li of lineItems) {
        await db.from("food_bill_items").insert({ food_bill_id: bill!.id, ...li });
      }

      if (isPaid && !payFromPass) {
        await recordTransaction(db, {
          student_id: studentId, branch_id: branchId, food_bill_id: bill!.id,
          category: "food", amount: total, payment_mode: paymentMode,
          created_by_staff_id: staff.id,
        });
      }

      return json({
        bill: { id: bill!.id, total, subtotal, discountAmount: disc, items: lineItems, paid: isPaid, paidFromPass: payFromPass },
        foodPassBalance: newPassBalance,
        foodPassShortfall: payFromPass && !passCoversOrder ? Math.round((total - Number(newPassBalance)) * 100) / 100 : null,
      });
    },
    create_food_item: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const { branchId, name, price } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      if (!name?.trim() || !price) return err("Name and price are required");
      const { data, error } = await db.from("food_items").insert({
        branch_id: branchId, name: name.trim(), price: Number(price), is_active: true,
      }).select("id").single();
      if (error) return err(error.message);
      return json({ ok: true, item: data });
    },
    update_food_item: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const { itemId, isActive, price } = payload;
      const updates: Record<string, unknown> = {};
      if (isActive !== undefined) updates.is_active = isActive;
      if (price !== undefined) updates.price = Number(price);
      await db.from("food_items").update(updates).eq("id", itemId);
      return json({ ok: true });
    },
    // ─── INVENTORY MANAGEMENT (fully separate from the food menu — see 045_inventory_items) ───
    list_inventory_items: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, allBranches } = payload;
      let q = db.from("inventory_items").select("*, branches(name)").order("name");
      if (allBranches && isOwnerOrAdmin(staff)) {
        // no branch filter — every branch's inventory, for the Combined Hall read-only view
      } else {
        if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
        q = q.eq("branch_id", branchId);
      }
      const { data } = await q;
      return json({ items: data ?? [] });
    },
    // Owner/admin types a name and a packet count. Upserts by (branch, lower(name)) — typing
    // an existing item's name adds to its count; typing a new name creates it. No link to
    // food_items at all, deliberately — inventory is tracked independently of the menu.
    add_inventory_item: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db, action } = ctx;
      const staff = ctx.staff!;
      if (!isOwnerOrAdmin(staff)) return err("Owner only", 403);
      const { branchId, name, addQuantity } = payload;
      if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
      const trimmedName = name?.trim();
      if (!trimmedName) return err("Enter an item name");
      const addNum = Number(addQuantity);
      if (!(addNum > 0)) return err("Enter a quantity greater than 0");

      const { data: existing } = await db.from("inventory_items").select("id, quantity")
        .eq("branch_id", branchId).ilike("name", trimmedName).maybeSingle();

      let itemId: string;
      let newQuantity: number;
      if (existing) {
        itemId = existing.id;
        newQuantity = Number(existing.quantity) + addNum;
        await db.from("inventory_items").update({ quantity: newQuantity }).eq("id", itemId);
      } else {
        const { data: created, error } = await db.from("inventory_items")
          .insert({ branch_id: branchId, name: trimmedName, quantity: addNum }).select("id").single();
        if (error) return err(error.message);
        itemId = created!.id;
        newQuantity = addNum;
      }
      await db.from("inventory_logs").insert({
        inventory_item_id: itemId, branch_id: branchId, action: "add", quantity: addNum, created_by_staff_id: staff.id,
      });
      return json({ ok: true, itemId, quantity: newQuantity });
    },
    // Staff-facing "Avail" — one click marks one packet used.
    avail_inventory_item: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db, action } = ctx;
      const staff = ctx.staff!;
      const { itemId, quantity } = payload;
      const availNum = quantity != null ? Number(quantity) : 1;
      if (!(availNum > 0)) return err("Enter a quantity greater than 0");
      const { data: item } = await db.from("inventory_items").select("quantity, branch_id").eq("id", itemId).single();
      if (!item) return err("Item not found");
      if (!requireBranch(staff, item.branch_id)) return err("Branch access denied", 403);
      if (item.quantity <= 0) return err("Out of stock");
      if (availNum > item.quantity) return err(`Only ${item.quantity} in stock`);
      const newQuantity = item.quantity - availNum;
      await db.from("inventory_items").update({ quantity: newQuantity }).eq("id", itemId);
      await db.from("inventory_logs").insert({
        inventory_item_id: itemId, branch_id: item.branch_id, action: "avail", quantity: availNum, created_by_staff_id: staff.id,
      });
      return json({ ok: true, quantity: newQuantity });
    },
    list_inventory_log: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, allBranches } = payload;
      let q = db.from("inventory_logs")
        .select("*, inventory_items(name), branches(name), staff:created_by_staff_id(display_name, username)")
        .order("created_at", { ascending: false }).limit(100);
      if (allBranches && isOwnerOrAdmin(staff)) {
        // no branch filter — every branch's activity, for the Combined Hall read-only view
      } else {
        if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
        q = q.eq("branch_id", branchId);
      }
      const { data } = await q;
      return json({ logs: data ?? [] });
    },
    list_food_bills: async (ctx: Ctx, payload: any): Promise<Response | undefined> => {
      const { db } = ctx;
      const staff = ctx.staff!;
      const { branchId, dateFrom, dateTo, allBranches } = payload;
      let q = db.from("food_bills").select("*, food_bill_items(*), branches(name)")
        .gte("created_at", istDayStart(dateFrom)).lte("created_at", istDayEnd(dateTo))
        .order("created_at", { ascending: false });
      if (allBranches && isOwnerOrAdmin(staff)) {
        // no branch filter — every branch's bills, for the Combined Hall read-only view
      } else {
        if (!requireBranch(staff, branchId)) return err("Branch access denied", 403);
        q = q.eq("branch_id", branchId);
      }
      const { data } = await q;
      return json({ bills: data ?? [] });
    },
  };
  return h;
}
