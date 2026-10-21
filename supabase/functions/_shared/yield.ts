// PSS-AI Phase 3, I3 — yield pricing for walk-ins. Pure code: the nightly job turns forecast
// occupancy (and a confirmed exam close by) into one price change per branch per day, always
// inside the owner's floor and ceiling and never outside ±20% of fee_config (C8). The AI plays no
// part in prices.

export const YIELD_LIMIT_PCT = 20;   // C8
export const EXAM_BUMP_PCT = 5;      // a confirmed exam within EXAM_WINDOW_DAYS
export const EXAM_WINDOW_DAYS = 30;

/** The most sessions running at the same moment, from [start, end) instants in ms. */
export function peakConcurrency(intervals: { start: number; end: number }[]): number {
  const edges: [number, number][] = [];
  for (const i of intervals) if (i.end > i.start) edges.push([i.start, 1], [i.end, -1]);
  // An end and a start at the same instant do not overlap: ends first.
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0, peak = 0;
  for (const [, d] of edges) { now += d; peak = Math.max(peak, now); }
  return peak;
}

/** The owner's floor and ceiling, clamped to ±20%. Missing or bad values mean the full range. */
export function yieldLimits(floorRaw: unknown, ceilingRaw: unknown): { floor: number; ceiling: number } {
  const f = Number(floorRaw), c = Number(ceilingRaw);
  const floor = Number.isFinite(f) && floorRaw !== null && floorRaw !== "" ? Math.max(-YIELD_LIMIT_PCT, Math.min(0, f)) : -YIELD_LIMIT_PCT;
  const ceiling = Number.isFinite(c) && ceilingRaw !== null && ceilingRaw !== "" ? Math.min(YIELD_LIMIT_PCT, Math.max(0, c)) : YIELD_LIMIT_PCT;
  return { floor, ceiling };
}

/** Today's change in percent and why, from forecast occupancy (0–1, or null with no history). */
export function yieldChange(occupancy: number | null, examSoon: string | null, limits = yieldLimits(null, null)): { pct: number; reason: string } {
  const parts: string[] = [];
  let pct = 0;
  if (occupancy === null) parts.push("no history for this weekday yet");
  else {
    const occ = `${Math.round(occupancy * 100)}% expected full`;
    if (occupancy >= 0.9) { pct += 15; parts.push(`${occ}: +15%`); }
    else if (occupancy >= 0.75) { pct += 8; parts.push(`${occ}: +8%`); }
    else if (occupancy <= 0.3) { pct -= 15; parts.push(`${occ}: −15%`); }
    else if (occupancy <= 0.45) { pct -= 8; parts.push(`${occ}: −8%`); }
    else parts.push(`${occ}: no change`);
  }
  if (examSoon) { pct += EXAM_BUMP_PCT; parts.push(`${examSoon}: +${EXAM_BUMP_PCT}%`); }
  const clamped = Math.max(limits.floor, Math.min(limits.ceiling, pct));
  if (clamped !== pct) parts.push(`kept within the owner's limits (${limits.floor}% to +${limits.ceiling}%)`);
  return { pct: clamped, reason: parts.join("; ") };
}

/** The walk-in price after a change: rounded to ₹5, and never outside ±20% of the base fee. */
export function yieldPrice(base: number, pct: number): number {
  if (!(base > 0)) return base;
  const p = Math.max(-YIELD_LIMIT_PCT, Math.min(YIELD_LIMIT_PCT, Number(pct) || 0));
  if (p === 0) return base;
  const lo = base * (1 - YIELD_LIMIT_PCT / 100), hi = base * (1 + YIELD_LIMIT_PCT / 100);
  let price = Math.round((base * (1 + p / 100)) / 5) * 5;
  while (price > hi) price -= 5;
  while (price < lo) price += 5;
  // Rounding never flips the direction of the change.
  if ((p > 0 && price < base) || (p < 0 && price > base)) price = base;
  return price;
}
