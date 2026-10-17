// Pure date helpers (IST calendar, month/day arithmetic), shared by the edge functions and
// unit-tested from tests/money. Moved unchanged from api/index.ts in PSS-AI P0.2.

// The edge function runs on UTC infrastructure with no "local" timezone, but the app is
// used in India — so "today" must be computed in IST (UTC+5:30), not the server's UTC
// date. Without this shift, the calendar day would flip 5.5 hours early (at UTC midnight,
// i.e. 5:30 AM IST) instead of at actual IST midnight, throwing off attendance, "due
// today" checks, daily reports, and the End Session day-lockout.
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export function todayISO() { return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10); }
// Same IST shift as todayISO(), but for an arbitrary timestamp (e.g. a stored paused_at)
// instead of "now" — needed to compare calendar dates rather than raw elapsed hours.
export function toISTDateStr(isoTimestamp: string) { return new Date(new Date(isoTimestamp).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10); }

// Start/end instants of an IST calendar date, for filtering UTC-stored timestamptz columns
// (created_at, redeemed_at, …) by an IST day. Returned as a plain "…Z" UTC instant (the IST
// boundary converted to its true UTC moment — e.g. IST midnight is the prior day 18:30 UTC),
// deliberately with no fractional seconds and no "+" offset so the value is byte-for-byte the
// same shape PostgREST already accepted here — safe to embed in .gte()/.lte() and inside an
// .or() filter string alike. Previously these ranges used a literal "…T00:00:00Z", which is
// actually 05:30 IST, so any row between IST midnight and 05:30 was counted on the wrong day.
export function istInstant(dateStr: string, istClock: string) {
  return new Date(`${dateStr}T${istClock}+05:30`).toISOString().replace(/\.\d{3}Z$/, "Z");
}
export function istDayStart(dateStr: string) { return istInstant(dateStr, "00:00:00"); }
// Inclusive end of the IST day at Postgres's full microsecond precision. A bare "…:59Z"
// left out anything stamped inside the day's final second (23:59:59.4 IST, say) from every
// <= range — dropped from that day's revenue and reports without a trace. No "+" is added,
// so the value stays safe inside .or() filter strings; JS Date parsing truncates it to .999.
export function istDayEnd(dateStr: string) { return istInstant(dateStr, "23:59:59").replace(/Z$/, ".999999Z"); }

// Pure UTC calendar arithmetic — "dateStr + T12:00:00" (no timezone designator) is parsed
// as *local* time by the JS Date constructor, and if the runtime's local timezone doesn't
// happen to be UTC, that silently shifts the result by a day. Using Date.UTC directly and
// getUTCDate/etc. sidesteps that ambiguity entirely, so a start date always advances by
// exactly N months (clamped to the last day of the target month on overflow, e.g. Jan 31 +
// 1 month -> Feb 28/29, not a roll into March).
export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCMonth(date.getUTCMonth() + months);
  if (date.getUTCDate() !== d) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(fromDateStr: string, toDateStr: string): number {
  return Math.floor((new Date(toDateStr + "T12:00:00").getTime() - new Date(fromDateStr + "T12:00:00").getTime()) / 86_400_000);
}

// A membership's end date is billing-cycle style: one day short of the same day N months
// out, so the period ends the day before it would "restart" on and grace begins on that
// restart day — e.g. start Aug 20, 1 month ends Sep 19, grace begins Sep 20 (not Sep 20
// itself as the end date). Starting on the 1st is the case that makes this legible — 1
// month from the 1st ends the last day of that same month, not the 1st of the next one.
//
// Starting on the 29th/30th/31st needs special care: addMonths() clamps to the target
// month's last day when that day-of-month doesn't exist there (e.g. Jan 31 + 1 month ->
// Feb 28). That clamped value is already the correct end date — subtracting one more day
// would double-truncate the period by a day it shouldn't lose. Only subtract when
// addMonths preserved the exact day-of-month (i.e. no clamping happened).
export function endDateForMonths(startDate: string, months: number): string {
  const startDay = Number(startDate.split("-")[2]);
  const target = addMonths(startDate, months);
  const targetDay = Number(target.split("-")[2]);
  return targetDay === startDay ? addDays(target, -1) : target;
}
