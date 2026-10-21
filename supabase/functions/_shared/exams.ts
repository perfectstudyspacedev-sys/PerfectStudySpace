// PSS-AI Phase 3, I25 and O9 — exam names to exam families, and the exam ladder. Pure code: the
// AI reads exam pages, but matching a notice to a student's "preparing for" text is done here, so
// the same text always gives the same family.

export const EXAM_SOURCES = ["tnpsc", "upsc", "ssc", "ibps", "sbi", "tnusrb", "rrb"] as const;
export type ExamSource = typeof EXAM_SOURCES[number];

// D8: the public pages read once a day. The owner can replace this list with the `exam_sources`
// setting (JSON: [{ "source": "tnpsc", "url": "https://…" }]); check each page before switching on.
export const DEFAULT_EXAM_PAGES: { source: ExamSource; url: string }[] = [
  { source: "tnpsc", url: "https://www.tnpsc.gov.in/English/notification.aspx" },
  { source: "upsc", url: "https://upsc.gov.in/examinations/active-exams" },
  { source: "ssc", url: "https://ssc.gov.in/" },
  { source: "ibps", url: "https://www.ibps.in/" },
  { source: "sbi", url: "https://sbi.co.in/web/careers/current-openings" },
  { source: "tnusrb", url: "https://www.tnusrb.tn.gov.in/" },
  { source: "rrb", url: "https://www.rrbcdg.gov.in/" },
];

// Most specific first. Each family is "<board>-<exam>"; a board alone is the fallback family.
const FAMILIES: [string, RegExp][] = [
  ["tnpsc-group-1", /\bgroup[\s-]*(?:1|i)(?:[\s-]*[bc])?\b/],
  ["tnpsc-group-2", /\bgroup[\s-]*(?:2|ii)(?:[\s-]*a)?\b/],
  ["tnpsc-group-4", /\bgroup[\s-]*(?:4|iv)\b/],
  ["upsc-mains", /\bmains?\b/],
  ["upsc-prelims", /\b(?:prelim(?:s|inary)?|cse|civil services)\b/],
  ["ssc-cgl", /\bcgl\b|combined graduate/],
  ["ssc-chsl", /\bchsl\b|higher secondary/],
  ["ssc-gd", /\bgd\b|general duty/],
  ["ibps-po", /\bpo\b|probationary officer/],
  ["ibps-clerk", /\bclerk|\bclerical\b/],
  ["sbi-po", /\bpo\b|probationary officer/],
  ["sbi-clerk", /\bclerk|junior associate/],
  ["tnusrb-si", /\bsi\b|sub[\s-]*inspector/],
  ["tnusrb-pc", /\bpc\b|police constable|constable/],
  ["rrb-ntpc", /\bntpc\b|non[\s-]*technical/],
  ["rrb-group-d", /\bgroup[\s-]*d\b|level[\s-]*1\b/],
  ["rrb-je", /\bje\b|junior engineer/],
];

const BOARD = /\b(tnpsc|upsc|ssc|ibps|sbi|tnusrb|rrb)\b/;

/** The family of an exam name or a student's "preparing for" text, or null. */
export function examFamily(text: unknown, sourceHint?: string | null): string | null {
  const t = String(text ?? "").toLowerCase().replace(/[._/]/g, " ");
  if (!t.trim()) return null;
  const board = t.match(BOARD)?.[1] ?? (sourceHint && sourceHint !== "manual" ? sourceHint : null)
    ?? (/civil services|\bias\b/.test(t) ? "upsc" : null);
  if (!board) return null;
  for (const [family, re] of FAMILIES) {
    if (family.startsWith(`${board}-`) && re.test(t)) return family;
  }
  return board;
}

/** Same family, or one is the other's board (a student who only wrote "TNPSC"). */
export function familiesMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a === b || a.split("-")[0] === b || b.split("-")[0] === a;
}

// C11: drafted in the build; the owner edits the `exam_ladder` setting (JSON array of arrays of
// family keys, lowest first).
export const DEFAULT_LADDER: string[][] = [
  ["tnpsc-group-4", "tnpsc-group-2", "tnpsc-group-1"],
  ["ssc-chsl", "ssc-cgl"],
  ["ibps-clerk", "ibps-po"],
  ["sbi-clerk", "sbi-po"],
  ["tnusrb-pc", "tnusrb-si"],
  ["rrb-group-d", "rrb-ntpc"],
  ["upsc-prelims", "upsc-mains"],
];

export const FAMILY_LABEL: Record<string, string> = {
  "tnpsc-group-1": "TNPSC Group 1", "tnpsc-group-2": "TNPSC Group 2", "tnpsc-group-4": "TNPSC Group 4",
  "upsc-prelims": "UPSC Prelims", "upsc-mains": "UPSC Mains", "ssc-cgl": "SSC CGL", "ssc-chsl": "SSC CHSL", "ssc-gd": "SSC GD",
  "ibps-po": "IBPS PO", "ibps-clerk": "IBPS Clerk", "sbi-po": "SBI PO", "sbi-clerk": "SBI Clerk",
  "tnusrb-si": "TNUSRB SI", "tnusrb-pc": "TNUSRB Constable", "rrb-ntpc": "RRB NTPC", "rrb-group-d": "RRB Group D", "rrb-je": "RRB JE",
  tnpsc: "TNPSC", upsc: "UPSC", ssc: "SSC", ibps: "IBPS", sbi: "SBI", tnusrb: "TNUSRB", rrb: "RRB",
};
export const familyLabel = (f: string | null) => (f ? FAMILY_LABEL[f] ?? f : "");

/** The owner's ladder from the setting, or the drafted one when it is missing or malformed. */
export function parseLadder(raw: unknown): string[][] {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(v) && v.length && v.every((r) => Array.isArray(r) && r.length >= 2 && r.every((x) => typeof x === "string" && x.length <= 40))) return v;
  } catch { /* fall through */ }
  return DEFAULT_LADDER;
}

/** The next exam up the ladder from a family, or null at the top or off the ladder. */
export function nextExam(family: string | null, ladder: string[][]): string | null {
  if (!family) return null;
  for (const rung of ladder) {
    const i = rung.indexOf(family);
    if (i >= 0 && i < rung.length - 1) return rung[i + 1];
  }
  return null;
}

/** The owner's page list from the setting, or the D8 defaults. */
export function parseExamPages(raw: unknown): { source: ExamSource; url: string }[] {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(v)) {
      const ok = v.filter((p) => p && EXAM_SOURCES.includes(p.source) && typeof p.url === "string" && /^https:\/\/[^\s]+$/.test(p.url));
      if (ok.length) return ok;
    }
  } catch { /* fall through */ }
  return DEFAULT_EXAM_PAGES;
}

/** robots.txt: may a crawler with no special name fetch this path? (User-agent: * rules only.) */
export function robotsAllows(robots: string, path: string): boolean {
  let applies = false, sawAgent = false;
  let best = { len: -1, allow: true };
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === "user-agent") {
      if (sawAgent) { applies = false; sawAgent = false; }
      if (value === "*") applies = true;
      continue;
    }
    sawAgent = true;
    if (!applies || (key !== "allow" && key !== "disallow") || !value) continue;
    const prefix = value.replace(/\*.*$/, "").replace(/\$$/, "");
    if (path.startsWith(prefix) && prefix.length > best.len) best = { len: prefix.length, allow: key === "allow" };
  }
  return best.allow;
}

/** Visible text of an HTML page, without scripts and styles, squeezed. */
export function pageText(html: string, max = 30_000): string {
  return html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>/gi, " [link: $1] ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, max);
}
