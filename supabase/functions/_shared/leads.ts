// PSS-AI Phase 3, I24 and the AI enquiry dedupe — pure code. Lead scores come from this hall's
// own history: how often enquiries from each source converted (smoothed toward the overall rate,
// so a source with few enquiries isn't 0% or 100%), how old the enquiry is, and how engaged it is.
// Duplicate candidates are pairs the page's same-phone grouping misses: similar names in the same
// branch. The AI only judges those pairs; it never sees phone numbers.

export const OPEN_STATUSES = ["new", "contacted", "trial_session"];
const SMOOTHING = 5;
const DEFAULT_RATE = 0.2;

export interface EnquiryRow {
  id: string; branch_id: string; name: string; phone: string | null; source: string | null; status: string | null;
  created_at: string; message?: string | null;
}

const SOURCE_WORDS: Record<string, string> = {
  walk_in: "Walk-in", phone_call: "Phone call", referral: "Referral", instagram: "Instagram",
  google_search: "Google Search", website_form: "Website form", website_chat: "Website chat",
};

/** Conversion rate per source from closed and open history (converted ÷ all), smoothed. */
export function sourceRates(history: { source: string | null; status: string | null }[]) {
  const total = history.length;
  const converted = history.filter((e) => e.status === "converted").length;
  const overall = total >= 10 ? converted / total : DEFAULT_RATE;
  const by = new Map<string, { n: number; c: number }>();
  for (const e of history) {
    const k = e.source ?? "walk_in";
    const v = by.get(k) ?? { n: 0, c: 0 };
    v.n++; if (e.status === "converted") v.c++;
    by.set(k, v);
  }
  const rate = (source: string | null) => {
    const v = by.get(source ?? "walk_in") ?? { n: 0, c: 0 };
    return { rate: (v.c + SMOOTHING * overall) / (v.n + SMOOTHING), n: v.n };
  };
  return { overall, rate };
}

/** 0–100 and the reason in words. Null for closed enquiries (converted or dropped). */
export function scoreEnquiry(
  e: EnquiryRow, rates: ReturnType<typeof sourceRates>, signals: { activities: number; openFollowup: boolean; chatMessages: number },
  now = Date.now(),
): { score: number; reason: string } | null {
  if (!OPEN_STATUSES.includes(e.status ?? "new")) return null;
  const { rate, n } = rates.rate(e.source);
  const ageDays = Math.max(0, (now - Date.parse(e.created_at)) / 86400e3);
  const recency = ageDays <= 3 ? 1 : ageDays <= 14 ? 0.8 : ageDays <= 30 ? 0.55 : 0.3;
  let boost = 0;
  const parts = [`${SOURCE_WORDS[e.source ?? "walk_in"] ?? e.source} enquiries convert ${Math.round(rate * 100)}% here${n < 10 ? " (few so far)" : ""}`];
  parts.push(ageDays < 1 ? "new today" : `${Math.floor(ageDays)} day${Math.floor(ageDays) === 1 ? "" : "s"} old`);
  if (e.status === "trial_session") { boost += 0.25; parts.push("had a trial session"); }
  else if (e.status === "contacted" || signals.activities >= 2) { boost += 0.1; parts.push("in touch"); }
  if (signals.openFollowup) { boost += 0.05; parts.push("follow-up planned"); }
  if (signals.chatMessages >= 3) { boost += 0.05; parts.push("chatted on the website"); }
  const score = Math.max(0, Math.min(1, rate * recency + boost));
  return { score: Math.round(score * 1000) / 10, reason: parts.join(" · ") };
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
const bigrams = (s: string) => {
  const t = ` ${s} `;
  const out = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) out.set(t.slice(i, i + 2), (out.get(t.slice(i, i + 2)) ?? 0) + 1);
  return out;
};

/** Dice similarity of two names' letter pairs, 0–1; "Ravi K" vs "Ravi Kumar" scores high. */
export function nameSimilarity(a: string, b: string): number {
  const x = normName(a), y = normName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const ba = bigrams(x), bb = bigrams(y);
  let inter = 0, na = 0, nb = 0;
  for (const v of ba.values()) na += v;
  for (const v of bb.values()) nb += v;
  for (const [k, v] of ba) inter += Math.min(v, bb.get(k) ?? 0);
  const dice = (2 * inter) / (na + nb);
  // One name's words all start the other's ("Ravi K" ⊂ "Ravi Kumar"): count it as close.
  const wa = x.split(" "), wb = y.split(" ");
  const prefix = (s: string[], t: string[]) => s.every((w, i) => t[i]?.startsWith(w));
  return Math.max(dice, prefix(wa, wb) || prefix(wb, wa) ? 0.8 : 0);
}

const digits = (p: string | null) => (p ?? "").replace(/\D/g, "").slice(-10);
/** How alike two phone numbers are, as a word for the AI (it never sees the numbers). */
export function phoneRelation(a: string | null, b: string | null): "same" | "one digit apart" | "two digits swapped" | "different" | "missing" {
  const x = digits(a), y = digits(b);
  if (x.length !== 10 || y.length !== 10) return "missing";
  if (x === y) return "same";
  const diff = [...x].map((c, i) => (c === y[i] ? -1 : i)).filter((i) => i >= 0);
  if (diff.length === 1) return "one digit apart";
  if (diff.length === 2 && diff[1] === diff[0] + 1 && x[diff[0]] === y[diff[1]] && x[diff[1]] === y[diff[0]]) return "two digits swapped";
  return "different";
}

/** Pairs worth asking about: same branch, both open, within 90 days, different phones, alike names. */
export function candidatePairs(rows: EnquiryRow[], seen: Set<string>, max = 30) {
  const open = rows.filter((e) => OPEN_STATUSES.includes(e.status ?? "new"));
  const out: { a: EnquiryRow; b: EnquiryRow; similarity: number; phones: string }[] = [];
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      const [a, b] = open[i].id < open[j].id ? [open[i], open[j]] : [open[j], open[i]];
      if (a.branch_id !== b.branch_id || seen.has(`${a.id}:${b.id}`)) continue;
      const phones = phoneRelation(a.phone, b.phone);
      if (phones === "same") continue; // the page already groups these
      if (Math.abs(Date.parse(a.created_at) - Date.parse(b.created_at)) > 90 * 86400e3) continue;
      const similarity = nameSimilarity(a.name, b.name);
      if (similarity >= 0.6 || (phones !== "different" && phones !== "missing" && similarity >= 0.4)) out.push({ a, b, similarity, phones });
    }
  }
  return out.sort((x, y) => y.similarity - x.similarity).slice(0, max);
}
