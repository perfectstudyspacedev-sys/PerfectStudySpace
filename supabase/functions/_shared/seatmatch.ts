// PSS-AI Phase 4, I4 and SP15 — which free desk to offer a student. Pure code. Order: the student's
// favourite desks (in their order), then desks with more of the tags they want, then the desks they
// used most in the last HISTORY_DAYS days, then the hall's own desk order.

export const DESK_TAGS = ["window", "power", "quiet", "ac"] as const;
export type DeskTag = typeof DESK_TAGS[number];
export const MAX_FAVOURITES = 3;
export const SEAT_HISTORY_DAYS = 60;

export interface DeskLite { id: string; label: string; sort_order?: number | null; tags?: string[] | null }
export interface SeatPrefs { desk_ids?: string[] | null; tags?: string[] | null }

export function cleanTags(tags: unknown): DeskTag[] {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.filter((t): t is DeskTag => (DESK_TAGS as readonly string[]).includes(t as string)))];
}

/** Free desks, best first, each with the reason it was ranked there. */
export function rankDesks(desks: DeskLite[], prefs: SeatPrefs | null, used: Map<string, number>): { desk: DeskLite; reason: string }[] {
  const favourites = (prefs?.desk_ids ?? []).slice(0, MAX_FAVOURITES);
  const wanted = cleanTags(prefs?.tags ?? []);
  const scored = desks.map((d) => {
    const fav = favourites.indexOf(d.id);
    const tagHits = wanted.filter((t) => (d.tags ?? []).includes(t)).length;
    const uses = used.get(d.id) ?? 0;
    const reason = fav >= 0 ? "one of your favourite desks"
      : tagHits > 0 ? `has ${wanted.filter((t) => (d.tags ?? []).includes(t)).join(", ")}`
      : uses > 0 ? "a desk you often use" : "the next free desk";
    return { desk: d, fav: fav >= 0 ? fav : MAX_FAVOURITES, tagHits, uses, reason };
  });
  scored.sort((a, b) => a.fav - b.fav || b.tagHits - a.tagHits || b.uses - a.uses ||
    (a.desk.sort_order ?? 0) - (b.desk.sort_order ?? 0) || a.desk.label.localeCompare(b.desk.label, undefined, { numeric: true }));
  return scored.map(({ desk, reason }) => ({ desk, reason }));
}

/** How many sessions the student had at each desk. */
export function deskUse(bookings: { desk_id: string | null }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of bookings) if (b.desk_id) m.set(b.desk_id, (m.get(b.desk_id) ?? 0) + 1);
  return m;
}

/** SP14: free floating seats — floating desks minus open sessions not sitting in a fixed cabin. */
export function freeSeats(floatingDesks: number, openSessions: { deskSeatType: string | null }[]): { free: number; total: number; inUse: number } {
  const inUse = openSessions.filter((s) => s.deskSeatType !== "fixed").length;
  return { free: Math.max(0, floatingDesks - inUse), total: floatingDesks, inUse };
}
