// PSS-AI Phase 5, I8 — the policy learner. Pure code. The owner's decided approvals are grouped by
// what was asked (scope) and a bucket of the request; a group decided the same way often enough
// becomes a proposed rule. Only the owner can sign a rule; only signed rules for student hold
// requests are ever applied by themselves (never a T3 action, S9).

export const MIN_SUPPORT = 6;
export const MIN_AGREEMENT = 0.9;
export const AUTO_SCOPES = new Set(["student_request:hold"]);

export interface Decision { kind: string; action: string | null; payload: any; status: string; requested_by_type?: string | null }

function band(n: number, edges: [number, number, string][], over: string) {
  for (const [lo, hi, label] of edges) if (n >= lo && n <= hi) return label;
  return over;
}
function whyKind(why: unknown): string {
  const w = String(why ?? "");
  if (/permanent/.test(w)) return "permanent";
  if (/longer than/.test(w)) return "long";
  if (/second hold/.test(w)) return "second";
  return "other";
}

/** The rule key of an approval: scope (kind:action) and a bucket of what was asked. */
export function bucketOf(a: Decision): { scope: string; bucket: string } {
  const scope = `${a.kind}:${a.action ?? "?"}`;
  const p = a.payload ?? {};
  if (scope === "student_request:hold") {
    return { scope, bucket: `days:${band(Number(p.days) || 0, [[1, 7, "1-7"], [8, 14, "8-14"], [15, 31, "15-31"]], "31+")}|why:${whyKind(p.why)}` };
  }
  const value = Number(p.cashbackValue ?? p.discountValue ?? p.amount);
  if (Number.isFinite(value) && value > 0) {
    return { scope, bucket: `value:${band(value, [[1, 100, "1-100"], [101, 300, "101-300"]], "300+")}|by:${a.requested_by_type ?? "?"}` };
  }
  return { scope, bucket: `by:${a.requested_by_type ?? "?"}` };
}

const WHY_WORDS: Record<string, string> = { permanent: "for a permanent seat", long: "longer than the self-hold limit", second: "a second hold in the month", other: "" };
const SCOPE_WORDS: Record<string, string> = {
  "student_request:hold": "Hold requests", "student_request:plan_change": "Plan change requests", "student_request:refund": "Refund requests",
  "student_request:waitlist_accept": "Permanent-seat acceptances", "t3_action:grant_cashback": "Cashbacks",
};

/** Words for a rule, e.g. "Hold requests of 8–14 days (longer than the self-hold limit): you approved 9 of 9." */
export function describeRule(scope: string, bucket: string, outcome: "approve" | "deny", agree: number, support: number): string {
  const parts = Object.fromEntries(bucket.split("|").map((x) => x.split(":") as [string, string]));
  const what = SCOPE_WORDS[scope] ?? `${scope.split(":")[1] ?? scope} requests`;
  const detail = [
    parts.days ? `of ${parts.days.replace("-", "–")} days` : "",
    parts.value ? `of ₹${parts.value.replace("-", "–")}` : "",
    parts.why && WHY_WORDS[parts.why] ? `(${WHY_WORDS[parts.why]})` : "",
    parts.by === "system" ? "queued by the system" : parts.by === "agent" ? "asked by an AI agent" : "",
  ].filter(Boolean).join(" ");
  return `${what}${detail ? ` ${detail}` : ""}: you ${outcome === "approve" ? "approved" : "denied"} ${agree} of ${support}.`.slice(0, 300);
}

export interface ProposedRule { scope: string; bucket: string; outcome: "approve" | "deny"; support: number; agreement: number; description: string }

/** Groups decided approvals and proposes a rule for each group decided the same way often enough. */
export function learnPolicies(decisions: Decision[], minSupport = MIN_SUPPORT, minAgreement = MIN_AGREEMENT): ProposedRule[] {
  const groups = new Map<string, { scope: string; bucket: string; approve: number; deny: number }>();
  for (const d of decisions) {
    if (d.status !== "approved" && d.status !== "denied") continue;
    const { scope, bucket } = bucketOf(d);
    const k = `${scope}§${bucket}`;
    const g = groups.get(k) ?? { scope, bucket, approve: 0, deny: 0 };
    if (d.status === "approved") g.approve++; else g.deny++;
    groups.set(k, g);
  }
  const out: ProposedRule[] = [];
  for (const g of groups.values()) {
    const support = g.approve + g.deny;
    if (support < minSupport) continue;
    const outcome = g.approve >= g.deny ? "approve" : "deny";
    const agree = Math.max(g.approve, g.deny);
    const agreement = agree / support;
    if (agreement < minAgreement) continue;
    out.push({ scope: g.scope, bucket: g.bucket, outcome, support, agreement: Math.round(agreement * 1000) / 1000, description: describeRule(g.scope, g.bucket, outcome, agree, support) });
  }
  return out.sort((a, b) => b.support - a.support || a.scope.localeCompare(b.scope));
}

/** Whether a pending approval falls under a rule. */
export function ruleMatches(rule: { scope: string; bucket: string }, a: Decision): boolean {
  const k = bucketOf(a);
  return k.scope === rule.scope && k.bucket === rule.bucket;
}
