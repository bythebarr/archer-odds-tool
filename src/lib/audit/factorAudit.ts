/**
 * The factor audit: where ARCHR's read holds up and where it misses, cut by
 * every factor we can tag a bet with. For each factor value it measures:
 *
 *   bias   mean ARCHR chance minus the actual hit rate (+ = ARCHR runs high)
 *   skill  the market's Brier minus ARCHR's (+ = ARCHR closer to what
 *          happened than the books' own no-vig chance; − = the books knew better)
 *   ROI    flat stakes on the sides ARCHR had a positive edge on, at the price
 *
 * Every number is also split into an EARLIER and a LATER half by date: an
 * effect only counts when it points the same way in both (a single 700-bet
 * pool can show anything once). Pure; the script supplies samples.
 */
import { americanToDecimal } from "@/lib/odds/americanOdds";

export interface AuditSample {
  /** ARCHR chance on the side. */
  p: number;
  /** The books' no-vig chance on the side; null without one. */
  market: number | null;
  /** The price the bet would be made at; null when only a number was posted. */
  price: number | null;
  won: 0 | 1;
  /** The market's closing no-vig chance on the side, where known: the move from `market` to it is closing-line value. */
  close?: number | null;
  /** ISO date, for the earlier/later split. */
  date: string;
  /** Factor → value, e.g. { gap: "ARCHR 8–15 pts above", record: "backs the price" }. */
  tags: Record<string, string>;
}

export interface CellStats {
  n: number;
  bias: number;
  /** Market Brier − ARCHR Brier over samples with a market; null without any. */
  skill: number | null;
  edgeBets: number;
  roi: number | null;
  /** Mean move of the market toward this side between the read and the close (+ = the books came to ARCHR); null without closes. */
  clv: number | null;
  clvN: number;
}

export interface FactorCell {
  factor: string;
  value: string;
  all: CellStats;
  early: CellStats;
  late: CellStats;
  /** Both halves agree on the sign of skill and of ROI relative to the pool's. */
  consistent: boolean;
  verdict: "helps" | "hurts" | "mixed" | "too few";
}

export interface FactorAudit {
  n: number;
  pool: CellStats;
  cells: FactorCell[];
}

/** A cell needs at least this many bets in each half before it gets a verdict. */
export const MIN_PER_HALF = 25;

const implied = (american: number) => (american < 0 ? -american / (100 - american) : 100 / (american + 100));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function cellStats(rows: AuditSample[]): CellStats {
  const withMarket = rows.filter((r) => r.market !== null);
  const edge = rows.filter((r) => r.price !== null && r.p > implied(r.price));
  const moves = rows.filter((r) => r.close != null && r.market !== null).map((r) => r.close! - r.market!);
  return {
    n: rows.length,
    bias: mean(rows.map((r) => r.p)) - mean(rows.map((r) => r.won)),
    skill: withMarket.length ? mean(withMarket.map((r) => (r.market! - r.won) ** 2 - (r.p - r.won) ** 2)) : null,
    edgeBets: edge.length,
    roi: edge.length ? mean(edge.map((r) => (r.won ? americanToDecimal(r.price!) - 1 : -1))) : null,
    clv: moves.length ? mean(moves) : null,
    clvN: moves.length,
  };
}

/** Earlier and later halves by date (ties go to the earlier half). */
export function splitByDate(rows: AuditSample[]): [AuditSample[], AuditSample[]] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const mid = Math.ceil(sorted.length / 2);
  return [sorted.slice(0, mid), sorted.slice(mid)];
}

const sign = (x: number | null, base: number | null) => (x === null || base === null || Number.isNaN(x) || Number.isNaN(base) ? 0 : Math.sign(x - base));

/**
 * One factor value's verdict. HELPS: ARCHR beats the market here (skill > 0)
 * and its edges pay better than the pool's, in both halves. HURTS: the
 * reverse in both halves. MIXED otherwise.
 */
function verdictOf(early: CellStats, late: CellStats, poolEarly: CellStats, poolLate: CellStats): FactorCell["verdict"] {
  if (early.n < MIN_PER_HALF || late.n < MIN_PER_HALF) return "too few";
  const skill = [sign(early.skill, 0), sign(late.skill, 0)];
  const roi = [sign(early.roi, poolEarly.roi), sign(late.roi, poolLate.roi)];
  if (skill.every((s) => s > 0) && roi.every((s) => s >= 0)) return "helps";
  if (skill.every((s) => s < 0) && roi.every((s) => s <= 0)) return "hurts";
  return "mixed";
}

export function auditFactors(samples: AuditSample[]): FactorAudit {
  const [early, late] = splitByDate(samples);
  const poolEarly = cellStats(early);
  const poolLate = cellStats(late);
  const lateSet = new Set(late);
  const factors = [...new Set(samples.flatMap((s) => Object.keys(s.tags)))].sort();
  const cells: FactorCell[] = [];
  for (const factor of factors) {
    const values = [...new Set(samples.map((s) => s.tags[factor]).filter((v): v is string => v !== undefined))].sort();
    for (const value of values) {
      const rows = samples.filter((s) => s.tags[factor] === value);
      const e = cellStats(rows.filter((r) => !lateSet.has(r)));
      const l = cellStats(rows.filter((r) => lateSet.has(r)));
      const verdict = verdictOf(e, l, poolEarly, poolLate);
      cells.push({
        factor,
        value,
        all: cellStats(rows),
        early: e,
        late: l,
        consistent: verdict === "helps" || verdict === "hurts",
        verdict,
      });
    }
  }
  return { n: samples.length, pool: cellStats(samples), cells };
}

/** Tag helpers shared by the sources, so every sport is cut the same way. */
export const TAGS = {
  gap(p: number, market: number | null): string | undefined {
    if (market === null) return undefined;
    const g = p - market;
    if (g > 0.15) return "ARCHR 15+ pts above books";
    if (g > 0.08) return "ARCHR 8–15 pts above books";
    if (g > 0.03) return "ARCHR 3–8 pts above books";
    if (g >= -0.03) return "ARCHR within 3 pts of books";
    if (g >= -0.08) return "ARCHR 3–8 pts below books";
    return "ARCHR 8+ pts below books";
  },
  price(price: number | null): string {
    if (price === null) return "no price";
    if (price <= -200) return "−200 or shorter";
    if (price <= -130) return "−199 to −130";
    if (price < 130) return "−129 to +129";
    return "+130 or longer";
  },
  record(hits: number, games: number, p: number, price: number | null): string {
    if (games < 5) return "thin record (<5 games)";
    if (price === null) return "no price to check";
    const r = hits / games;
    const imp = implied(price);
    const modelLikes = p > imp;
    if (modelLikes && r >= imp) return "model likes it, record backs it";
    if (modelLikes && r < imp - 0.1) return "model likes it, record doesn't";
    if (!modelLikes && r >= imp + 0.1) return "hot record, model passes";
    return "record near the price";
  },
  sample(games: number): string {
    if (games < 10) return "<10 games of history";
    if (games < 30) return "10–29 games";
    return "30+ games";
  },
};
