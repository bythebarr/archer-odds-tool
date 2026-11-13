/**
 * Why the Confidence grade (./confidence) lands where it does: diagnosis only,
 * nothing here changes a grade. scripts/backtest-confidence prints these for
 * the live board and for settled leans.
 */
import { americanToDecimal } from "@/lib/odds/americanOdds";
import { BASE, GRADE_CUTS, gradeOf, type Confidence, type ConfidenceFactor, type ConfidenceGrade } from "./confidence";

const GRADES: ConfidenceGrade[] = ["A", "B", "C", "D"];

/** Rows per grade. */
export function gradeCounts(cs: Confidence[]): Record<ConfidenceGrade, number> {
  const out = { A: 0, B: 0, C: 0, D: 0 };
  for (const c of cs) out[c.grade]++;
  return out;
}

/** Scores in 5-point buckets ("60–64"), low to high, empty buckets left out. */
export function scoreHistogram(scores: number[]): { bucket: string; lo: number; n: number }[] {
  const by = new Map<number, number>();
  for (const s of scores) {
    const lo = Math.floor(s / 5) * 5;
    by.set(lo, (by.get(lo) ?? 0) + 1);
  }
  return [...by].sort((a, b) => a[0] - b[0]).map(([lo, n]) => ({ bucket: `${lo}–${lo + 4}`, lo, n }));
}

/** The factor that cost the most points (null when nothing cost any). */
export function biggestCost(c: Confidence): ConfidenceFactor | null {
  const costs = c.factors.filter((f) => f.effect < 0).sort((a, b) => a.effect - b.effect);
  return costs[0] ?? null;
}

/** The score with every cost set to zero: the most this bet could reach on its positives alone. */
export function ceiling(c: Confidence): number {
  return Math.min(100, BASE + c.factors.filter((f) => f.effect > 0).reduce((s, f) => s + f.effect, 0));
}

/** The largest score the rules can give at all, given whether the stat's report card passed. */
export function maxPossible(trusted: boolean | undefined): number {
  // track (+10 trusted, −5 otherwise, 0 without a card) + sample (+5) + market gap (+5) + distance (+10)
  const track = trusted === undefined ? 0 : trusted ? 10 : -5;
  return BASE + track + 5 + 5 + 10;
}

export interface FactorLine {
  key: ConfidenceFactor["key"];
  /** Rows the factor moved (effect ≠ 0), and its share of all rows. */
  moved: number;
  share: number;
  /** Mean effect over the rows it moved. */
  meanEffect: number;
  /** Rows where it was the single biggest cost. */
  biggestCost: number;
}

/** Per factor: how often it moves a grade, by how much, and how often it's the biggest cost. */
export function factorSummary(cs: Confidence[]): FactorLine[] {
  const keys = [...new Set(cs.flatMap((c) => c.factors.map((f) => f.key)))];
  return keys
    .map((key) => {
      const moved = cs.flatMap((c) => c.factors.filter((f) => f.key === key && f.effect !== 0));
      return {
        key,
        moved: moved.length,
        share: cs.length ? moved.length / cs.length : 0,
        meanEffect: moved.length ? moved.reduce((s, f) => s + f.effect, 0) / moved.length : 0,
        biggestCost: cs.filter((c) => biggestCost(c)?.key === key).length,
      };
    })
    .sort((a, b) => a.meanEffect * a.moved - b.meanEffect * b.moved);
}

/** How many grades change if one factor's points are taken out (diagnosis of a single rule). */
export function gradesChangedWithout(cs: Confidence[], key: ConfidenceFactor["key"]): number {
  return cs.filter((c) => {
    const f = c.factors.find((x) => x.key === key);
    if (!f || f.effect === 0) return false;
    return gradeOf(Math.max(0, Math.min(100, c.score - f.effect))) !== c.grade;
  }).length;
}

export interface ScoredOutcome {
  score: number;
  archr: number;
  priceAmerican: number | null;
  won: 0 | 1;
}

export interface BucketStats {
  label: string;
  n: number;
  meanArchr: number;
  hitRate: number;
  brier: number;
  edgeBets: number;
  edgeRoi: number | null;
}

const implied = (american: number) => (american < 0 ? -american / (100 - american) : 100 / (american + 100));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function bucketStats(label: string, rows: ScoredOutcome[]): BucketStats {
  const edge = rows.filter((r) => r.priceAmerican !== null && r.archr > implied(r.priceAmerican));
  return {
    label,
    n: rows.length,
    meanArchr: mean(rows.map((r) => r.archr)),
    hitRate: mean(rows.map((r) => r.won)),
    brier: mean(rows.map((r) => (r.archr - r.won) ** 2)),
    edgeBets: edge.length,
    edgeRoi: edge.length ? mean(edge.map((r) => (r.won ? americanToDecimal(r.priceAmerican!) - 1 : -1))) : null,
  };
}

/** Outcomes by grade (A–D) and by 5-point score bucket. */
export function outcomeTables(rows: ScoredOutcome[]): { grades: BucketStats[]; buckets: BucketStats[] } {
  const grades = GRADES.map((g) => bucketStats(g, rows.filter((r) => gradeOf(r.score) === g)));
  const buckets = scoreHistogram(rows.map((r) => r.score)).map((b) => bucketStats(b.bucket, rows.filter((r) => r.score >= b.lo && r.score < b.lo + 5)));
  return { grades, buckets };
}

/** The current cuts, for printing. */
export const CUTS_LINE = GRADE_CUTS.filter(([, cut]) => Number.isFinite(cut))
  .map(([g, cut]) => `${g} ≥ ${cut}`)
  .join(" · ");
