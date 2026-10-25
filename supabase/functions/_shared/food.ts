// PSS-AI Phase 4, I20/I21 and SP16 — food demand and supplier orders. Pure code. Demand for a day
// is the average sold on the same weekday over the last WEEKS weeks; an item with no sales on that
// weekday uses its plain daily average. A supplier draft covers LEAD_DAYS of forecast use with a
// SAFETY factor, minus what is in stock.
import { addDays } from "./dates.ts";

export const FORECAST_WEEKS = 4;
export const FORECAST_DAYS = 7;
export const LEAD_DAYS = 3;
export const SAFETY = 1.2;
export const MAX_ORDER_QTY = 10;
export const MAX_ORDER_LINES = 10;
export const MAX_OPEN_ORDERS = 3;

function weekday(date: string): number { return new Date(`${date}T00:00:00Z`).getUTCDay(); }

/** Expected quantity per item for each of the `days` days from `from` (IST dates). `sales` are
 * quantities sold per IST date over the WEEKS weeks before `from`. */
export function forecastDemand(sales: { date: string; itemId: string; qty: number }[], from: string, days = FORECAST_DAYS, weeks = FORECAST_WEEKS): Map<string, number[]> {
  const start = addDays(from, -weeks * 7);
  const byItem = new Map<string, { perWeekday: number[]; total: number }>();
  for (const s of sales) {
    if (s.date < start || s.date >= from || !(s.qty > 0)) continue;
    const e = byItem.get(s.itemId) ?? { perWeekday: Array(7).fill(0), total: 0 };
    e.perWeekday[weekday(s.date)] += s.qty;
    e.total += s.qty;
    byItem.set(s.itemId, e);
  }
  const out = new Map<string, number[]>();
  for (const [itemId, e] of byItem) {
    const daily = e.total / (weeks * 7);
    out.set(itemId, Array.from({ length: days }, (_, i) => {
      const wd = weekday(addDays(from, i));
      const avg = e.perWeekday[wd] > 0 ? e.perWeekday[wd] / weeks : daily;
      return Math.round(avg * 10) / 10;
    }));
  }
  return out;
}

/** Packets of each inventory item to order: LEAD_DAYS of forecast use × SAFETY, minus stock. */
export function supplierDraft(
  inventory: { id: string; name: string; quantity: number; supplier_phone?: string | null }[],
  links: { foodItemId: string; inventoryItemId: string; perUnit: number }[],
  forecast: Map<string, number[]>,
  leadDays = LEAD_DAYS,
): { inventoryItemId: string; name: string; have: number; need: number; order: number; supplierPhone: string | null }[] {
  const need = new Map<string, number>();
  for (const l of links) {
    const f = forecast.get(l.foodItemId);
    if (!f) continue;
    const use = f.slice(0, leadDays).reduce((a, b) => a + b, 0) * l.perUnit;
    need.set(l.inventoryItemId, (need.get(l.inventoryItemId) ?? 0) + use);
  }
  const lines = [];
  for (const inv of inventory) {
    const n = Math.ceil((need.get(inv.id) ?? 0) * SAFETY);
    const have = Math.max(0, Number(inv.quantity) || 0);
    if (n > have) lines.push({ inventoryItemId: inv.id, name: inv.name, have, need: n, order: n - have, supplierPhone: inv.supplier_phone ?? null });
  }
  return lines.sort((a, b) => a.name.localeCompare(b.name));
}

/** Check an order's lines: whole quantities 1–MAX_ORDER_QTY, one line per item, at most MAX_ORDER_LINES. */
export function orderLines(items: unknown): { foodItemId: string; quantity: number }[] | { error: string } {
  if (!Array.isArray(items) || items.length === 0) return { error: "Choose something to order" };
  if (items.length > MAX_ORDER_LINES) return { error: `At most ${MAX_ORDER_LINES} different items in one order` };
  const seen = new Set<string>();
  const out = [];
  for (const it of items) {
    const id = (it as any)?.foodItemId, q = Number((it as any)?.quantity);
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return { error: "Unknown item" };
    if (!Number.isInteger(q) || q < 1 || q > MAX_ORDER_QTY) return { error: `Choose 1 to ${MAX_ORDER_QTY} of each item` };
    if (seen.has(id)) return { error: "Each item once, with its quantity" };
    seen.add(id);
    out.push({ foodItemId: id, quantity: q });
  }
  return out;
}
