// PSS-AI Phase 5, O6 — weekly experiments (C20). Pure code: which variant a student sees (a stable
// hash, so the same student always gets the same one) and whether a difference is real (a
// two-proportion z-test; a winner needs 20 students per variant and p < 0.1).

export const MIN_PER_VARIANT = 20;
export const MAX_P = 0.1;
export const CONVERT_DAYS = { winback_offer: 21, next_exam_offer: 21, menu_feature: 7 } as const;

/** FNV-1a, 32-bit. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export function variantFor(experimentId: string, studentId: string, keys: string[]): string {
  return keys[fnv(`${experimentId}:${studentId}`) % keys.length];
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26). */
function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

export function abResult(stats: { key: string; n: number; k: number }[]) {
  const rows = stats.map((s) => ({ ...s, rate: s.n ? Math.round((s.k / s.n) * 1000) / 1000 : 0 }));
  if (rows.length !== 2) return { rows, p: null as number | null, winner: null as string | null, enough: false };
  const [a, b] = rows;
  const enough = a.n >= MIN_PER_VARIANT && b.n >= MIN_PER_VARIANT;
  const pooled = (a.k + b.k) / Math.max(1, a.n + b.n);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / Math.max(1, a.n) + 1 / Math.max(1, b.n)));
  const z = se > 0 ? (a.k / Math.max(1, a.n) - b.k / Math.max(1, b.n)) / se : 0;
  const p = Math.round(2 * (1 - phi(Math.abs(z))) * 1000) / 1000;
  const winner = enough && p < MAX_P && a.rate !== b.rate ? (a.rate > b.rate ? a.key : b.key) : null;
  return { rows, p, winner, enough };
}

/** Checks an experiment's variants for its kind (C12: offers at most 10%). */
export function cleanVariants(kind: string, variants: unknown): { key: string; label: string; value: any }[] | { error: string } {
  if (!Array.isArray(variants) || variants.length !== 2) return { error: "An experiment compares two variants" };
  const out = [];
  for (const [i, v] of variants.entries()) {
    const key = i === 0 ? "A" : "B";
    const label = String((v as any)?.label ?? "").trim().slice(0, 60) || key;
    const raw = (v as any)?.value;
    if (kind === "winback_offer") {
      const pct = Number(raw);
      if (!Number.isInteger(pct) || pct < 0 || pct > 10) return { error: "A win-back offer is 0 to 10% (C12)" };
      out.push({ key, label, value: pct });
    } else if (kind === "next_exam_offer") {
      const months = Number(raw);
      if (![1, 2, 3, 6].includes(months)) return { error: "A next-exam plan is 1, 2, 3 or 6 months" };
      out.push({ key, label, value: months });
    } else if (kind === "menu_feature") {
      if (typeof raw !== "string" || !/^[0-9a-f-]{36}$/i.test(raw)) return { error: "Choose a menu item for each variant" };
      out.push({ key, label, value: raw });
    } else return { error: "Unknown kind of experiment" };
  }
  if (out[0].value === out[1].value) return { error: "The two variants must differ" };
  return out;
}
