// PSS-AI Phase 3, O1 and SP10 — which hours of a permanent cabin may be sold to a walk-in. Pure
// code. A member's usage of each hour is the share of recent days on which a session covered it;
// only floor(expected free hours × 0.8) are offered (C7, 20% safety margin), as one window of
// hours each used on at most a quarter of days.
import { IST_OFFSET_MS } from "./dates.ts";

export const SAFETY_MARGIN = 0.2;     // C7
export const MAX_HOUR_USE = 0.25;     // never offer an hour the member used on more than 1 day in 4
export const HISTORY_DAYS = 28;
export const MIN_HISTORY_DAYS = 14;
export const MIN_WINDOW_HOURS = 2;
export const OPEN_HOUR = 6;           // releases and predictions stay between 06:00 and 23:00 IST
export const CLOSE_HOUR = 23;
export const RELEASE_AHEAD_DAYS = 7;
export const RELEASE_CREDIT_PCT = 50; // D7

/** The IST instant (ISO, UTC) of an hour on a date: istHour("2026-10-22", 9) → 03:30Z. */
export function istHour(date: string, hour: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - IST_OFFSET_MS + hour * 3600e3).toISOString();
}

/** The IST hour (0–23) and date of an instant. */
export function istParts(iso: string | number): { date: string; hour: number; minute: number } {
  const d = new Date((typeof iso === "number" ? iso : Date.parse(iso)) + IST_OFFSET_MS);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/**
 * Share of days (out of `days`, the IST dates the member was not on hold) on which a session
 * covered each hour of the day. Sessions are [start, end) instants in ms.
 */
export function hourlyUsage(sessions: { start: number; end: number }[], days: string[]): number[] {
  const usedOn: Set<string>[] = Array.from({ length: 24 }, () => new Set<string>());
  const wanted = new Set(days);
  for (const s of sessions) {
    for (let t = Math.floor((s.start + IST_OFFSET_MS) / 3600e3) * 3600e3 - IST_OFFSET_MS; t < s.end; t += 3600e3) {
      // The hour [t, t+1h) counts when the session covers any of it.
      if (t + 3600e3 <= s.start) continue;
      const { date, hour } = istParts(t);
      if (wanted.has(date)) usedOn[hour].add(date);
    }
  }
  return usedOn.map((set) => (days.length ? set.size / days.length : 1));
}

/**
 * The window to offer among hours [fromHour, toHour): the expected free hours times (1 − margin),
 * rounded down, as the contiguous run with the least use, whose every hour is used on at most
 * MAX_HOUR_USE of days. Null when nothing qualifies.
 */
export function predictWindow(usage: number[], fromHour: number, toHour: number): { start: number; end: number; probability: number } | null {
  const from = Math.max(fromHour, OPEN_HOUR), to = Math.min(toHour, CLOSE_HOUR);
  if (to - from < MIN_WINDOW_HOURS) return null;
  let expectedFree = 0;
  for (let h = from; h < to; h++) expectedFree += 1 - usage[h];
  const length = Math.floor(expectedFree * (1 - SAFETY_MARGIN) + 1e-9);
  if (length < MIN_WINDOW_HOURS) return null;
  let best: { start: number; end: number; sum: number; max: number } | null = null;
  for (let len = Math.min(length, to - from); len >= MIN_WINDOW_HOURS && !best; len--) {
    for (let s = from; s + len <= to; s++) {
      const hours = usage.slice(s, s + len);
      const max = Math.max(...hours);
      if (max > MAX_HOUR_USE) continue;
      const sum = hours.reduce((a, b) => a + b, 0);
      if (!best || sum < best.sum) best = { start: s, end: s + len, sum, max };
    }
  }
  return best ? { start: best.start, end: best.end, probability: Math.round((1 - best.max) * 1000) / 1000 } : null;
}

/** D7: the member's credit for a resold member release, rounded to the rupee. */
export function releaseCredit(amount: number, pct = RELEASE_CREDIT_PCT): number {
  return Math.max(0, Math.round((Number(amount) || 0) * pct / 100));
}

/** C7: one free day = one day of the member's plan price, rounded to the rupee. */
export function freeDayCredit(mem: { plan_amount?: number | null; plan_days?: number | null; monthly_fee?: number | null }): number {
  const amount = Number(mem.plan_amount), days = Number(mem.plan_days);
  if (amount > 0 && days > 0) return Math.round(amount / days);
  return Math.round((Number(mem.monthly_fee) || 0) / 30);
}

/** The parts of [start, end) left over when [soldStart, soldEnd) is sold, at least an hour each. */
export function leftovers(start: number, end: number, soldStart: number, soldEnd: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  if (soldStart - start >= 3600e3) out.push({ start, end: soldStart });
  if (end - soldEnd >= 3600e3) out.push({ start: soldEnd, end });
  return out;
}
