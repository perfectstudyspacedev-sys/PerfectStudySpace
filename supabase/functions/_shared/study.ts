// PSS-AI Phase 5 — the space-yield optimiser (O7) and the portal's study pages (SP18 focus profile,
// SP19 exam coach, SP20 Study Wrapped, SP21 study buddy pairing). Pure code; IST throughout.
import { addDays, daysBetween, IST_OFFSET_MS } from "./dates.ts";

const istDate = (ms: number) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
const istHourOf = (ms: number) => new Date(ms + IST_OFFSET_MS).getUTCHours();
const istWeekday = (ms: number) => new Date(ms + IST_OFFSET_MS).getUTCDay();

// ── O7: occupancy by weekday × hour ──
export interface Span { start: number; end: number }
/** grid[weekday 0–6][hour 0–23] = average occupied share of `seats` over `weeks` weeks. */
export function occupancyGrid(sessions: Span[], seats: number, weeks: number): number[][] {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  if (!(seats > 0) || !(weeks > 0)) return grid;
  for (const s of sessions) {
    if (!(s.end > s.start)) continue;
    for (let t = Math.floor((s.start + IST_OFFSET_MS) / 3600e3) * 3600e3 - IST_OFFSET_MS; t < s.end; t += 3600e3) {
      const covered = Math.min(s.end, t + 3600e3) - Math.max(s.start, t);
      if (covered > 0) grid[istWeekday(t)][istHourOf(t)] += covered / 3600e3;
    }
  }
  return grid.map((row) => row.map((v) => Math.round((v / weeks / seats) * 1000) / 1000));
}

export function spaceSuggestions(input: { grid: number[][]; seats: number; cabins: number; cabinUse: number; waitlist: number }) {
  const out: { kind: string; text: string }[] = [];
  const cells = input.grid.flat();
  const hot = cells.filter((v) => v > 0.95).length;
  const peak = Math.max(0, ...cells);
  const dayNames = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
  if (hot >= 6) out.push({ kind: "add_seats", text: `Open seats are over 95% full for ${hot} hours a week — more seats would sell.` });
  if (input.waitlist >= 3 && peak < 0.6 && input.seats >= 5) {
    const convert = Math.min(input.waitlist, Math.floor(input.seats * (0.6 - peak) + 1e-9));
    if (convert > 0) out.push({ kind: "convert_to_cabins", text: `${input.waitlist} people wait for a cabin while open seats never pass ${Math.round(peak * 100)}% — about ${convert} seats could become cabins.` });
  }
  // Blocks of 3+ consecutive hours between 06:00 and 22:00 under 25%, on at least 4 weekdays.
  const quiet: string[] = [];
  for (let h = 6; h <= 19; h++) {
    const days = input.grid.filter((row) => row[h] < 0.25 && row[h + 1] < 0.25 && row[h + 2] < 0.25).length;
    if (days >= 4) quiet.push(`${String(h).padStart(2, "0")}:00–${String(h + 3).padStart(2, "0")}:00`);
  }
  if (quiet.length) out.push({ kind: "quiet_hours", text: `Seats stay under 25% from ${quiet[0]} on most days — an offer for those hours, or a group study room, could fill them.` });
  const weekday = input.grid.map((row, d) => ({ d, avg: row.slice(6, 22).reduce((a, b) => a + b, 0) / 16 })).sort((a, b) => a.avg - b.avg)[0];
  if (weekday && weekday.avg < 0.2 && cells.some((v) => v > 0)) out.push({ kind: "quiet_day", text: `${dayNames[weekday.d]} are the quietest (${Math.round(weekday.avg * 100)}% on average).` });
  if (input.cabins > 0 && input.cabinUse < 0.4) out.push({ kind: "cabins_unused", text: `Cabins are used ${Math.round(input.cabinUse * 100)}% of their hours — releasing hours (Phase 3) could sell the rest.` });
  return out;
}

// ── SP18: focus by time of day ──
export const WINDOWS = ["morning", "afternoon", "evening", "night"] as const;
export type StudyWindow = typeof WINDOWS[number];
export function windowOf(hour: number): StudyWindow {
  return hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : hour >= 17 && hour < 21 ? "evening" : "night";
}
export function focusProfile(ratings: { start: number; rating: number }[]) {
  const by = new Map<StudyWindow, number[]>();
  const days = Array.from({ length: 7 }, () => [] as number[]);
  for (const r of ratings) {
    const w = windowOf(istHourOf(r.start));
    by.set(w, [...(by.get(w) ?? []), r.rating]);
    days[istWeekday(r.start)].push(r.rating);
  }
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const windows = WINDOWS.map((w) => ({ window: w, average: avg(by.get(w) ?? []), ratings: (by.get(w) ?? []).length }));
  const best = windows.filter((w) => w.ratings >= 2 && w.average != null).sort((a, b) => b.average! - a.average! || b.ratings - a.ratings)[0] ?? null;
  return { ratings: ratings.length, average: avg(ratings.map((r) => r.rating)), windows, weekdays: days.map((d, i) => ({ weekday: i, average: avg(d), ratings: d.length })), best: best?.window ?? null };
}

// ── SP20: Study Wrapped ──
export interface StudySession { start: number; end: number; pauseMinutes?: number; desk?: string | null }
export function minutesPerDay(sessions: StudySession[]) {
  const m = new Map<string, number>();
  for (const s of sessions) {
    if (!(s.end > s.start)) continue;
    const mins = Math.max(0, Math.round((s.end - s.start) / 60000) - (s.pauseMinutes ?? 0));
    const d = istDate(s.start);
    m.set(d, (m.get(d) ?? 0) + mins);
  }
  return m;
}
export function wrapped(sessions: StudySession[], ratings: number[], branchMemberMinutes: number[]) {
  const perDay = minutesPerDay(sessions);
  const days = [...perDay.keys()].sort();
  let longest = 0, run = 0, prev: string | null = null;
  for (const d of days) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; longest = Math.max(longest, run); prev = d; }
  const total = [...perDay.values()].reduce((a, b) => a + b, 0);
  const best = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const desks = new Map<string, number>();
  for (const s of sessions) if (s.desk) desks.set(s.desk, (desks.get(s.desk) ?? 0) + 1);
  const favDesk = [...desks.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const below = branchMemberMinutes.filter((x) => x < total).length;
  const percentile = branchMemberMinutes.length >= 5 ? Math.round((below / branchMemberMinutes.length) * 100) : null;
  return {
    minutes: total, days: days.length, longestStreak: longest, bestDay: best ? { date: best[0], minutes: best[1] } : null, favouriteDesk: favDesk,
    focus: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null, percentile,
  };
}

// ── SP19: the exam coach ──
export function examCoach(input: { today: string; examDate: string | null; examLabel: string | null; minutesLast14: number[]; planHours: number }) {
  const avgHours = Math.round((input.minutesLast14.reduce((a, b) => a + b, 0) / 14 / 60) * 10) / 10;
  const target = input.planHours > 0 ? input.planHours : 6;
  const daysLeft = input.examDate ? daysBetween(input.today, input.examDate) : null;
  const phase = daysLeft == null ? "no_exam" : daysLeft <= 30 ? "last_month" : daysLeft <= 90 ? "near" : "far";
  const onTrack = avgHours >= target * 0.8;
  const studied = input.minutesLast14.filter((m) => m > 0).length;
  const tips: string[] = [];
  if (phase === "far") tips.push("Build the habit: the same hours every day matter more than long days now.", "Cover each subject once before revising any of them twice.");
  if (phase === "near") tips.push("Start timed mock tests every week.", "Keep a list of what you get wrong and revise it every Sunday.");
  if (phase === "last_month") tips.push("Revise; don't start new topics.", "Take full mock tests at the exam's own time of day.", "Sleep well — the last week is for staying fresh.");
  if (phase === "no_exam") tips.push("Tell the desk which exam you are preparing for to see your countdown here.");
  if (!onTrack) tips.unshift(`You studied ${avgHours} h a day these two weeks; your plan has ${target} h — try to use more of it.`);
  if (studied < 10 && phase !== "no_exam") tips.push(`You came in on ${studied} of the last 14 days — regular days help most.`);
  return { daysLeft, phase, examLabel: input.examLabel, examDate: input.examDate, avgHours, target, onTrack, daysStudied: studied, tips };
}

// ── SP21: study buddy pairing ──
export interface BuddyProfile { student_id: string; branch_id: string; exam_family: string | null; study_window: string }
/** Pairs opted-in students of the same branch, exam family and window, each at most once a run. */
export function buddyPairs(profiles: BuddyProfile[], busy: Set<string>, seenPairs: Set<string>): [string, string][] {
  const groups = new Map<string, string[]>();
  for (const p of profiles) {
    if (busy.has(p.student_id) || !p.exam_family) continue;
    const k = `${p.branch_id}|${p.exam_family}|${p.study_window}`;
    groups.set(k, [...(groups.get(k) ?? []), p.student_id]);
  }
  const out: [string, string][] = [];
  for (const ids of groups.values()) {
    const left = [...ids].sort();
    while (left.length >= 2) {
      const a = left.shift()!;
      const i = left.findIndex((b) => !seenPairs.has([a, b].sort().join(":")));
      if (i < 0) continue;
      const b = left.splice(i, 1)[0];
      out.push(a < b ? [a, b] : [b, a]);
    }
  }
  return out;
}

// ── I33: certificates ──
export function certificateText(c: { id: string; hall_name: string; student_name: string; date_from: string; date_to: string; hours: number; days: number }) {
  return `pss-cert:v1|${c.id}|${c.hall_name}|${c.student_name}|${c.date_from}|${c.date_to}|${Number(c.hours).toFixed(2)}|${c.days}`;
}
export async function hmacHex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
