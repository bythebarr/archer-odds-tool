/**
 * Does the Confidence grade (./confidence) mean anything? On graded props, a
 * grade earns its place only if higher grades are where ARCHR's read holds up
 * better:
 *
 *   - ARCHR Chance is more accurate there (lower Brier score), and
 *   - the bets ARCHR likes (positive edge at the closing price) win more
 *     money there than in the lower grades.
 *
 * Grades are pooled into HIGH (A+B) and LOW (C+D) for the verdict, since a
 * few hundred samples can't separate four buckets; each grade is still
 * printed on its own. Pure: scripts/backtest-confidence supplies samples.
 */
import { americanToDecimal } from "@/lib/odds/americanOdds";
import type { Rate } from "@/lib/builder/types";
import { confidenceOf, type ConfidenceGrade, type ConfidenceInput } from "./confidence";

export interface ConfidenceSample {
  /** ARCHR Chance on the side. */
  archr: number;
  marketChance: number | null;
  /** Closing best price on the side; null leaves the side out of the edge bets. */
  priceAmerican: number | null;
  rate: Rate;
  sampleGames: number;
  minutes?: ConfidenceInput["minutes"];
  z?: number | null;
  side?: "over" | "under";
  sport?: string;
  won: 0 | 1;
}

export interface GradeStats {
  label: string;
  n: number;
  /** Mean ARCHR Chance vs the actual hit rate. */
  meanArchr: number;
  hitRate: number;
  /** ARCHR Chance's Brier score in the bucket: lower is more accurate. */
  brier: number;
  /** Sides ARCHR had a positive edge on at the closing price, bet flat. */
  edgeBets: number;
  edgeRoi: number;
  edgeRoiLow: number;
  edgeRoiHigh: number;
}

export interface ConfidenceValidation {
  n: number;
  grades: GradeStats[];
  high: GradeStats;
  low: GradeStats;
  verdict: "validated" | "not-validated" | "data-required";
  reason: string;
}

/** Each pooled side needs at least this many samples, and edge bets, before a verdict. */
export const MIN_POOLED = 100;
export const MIN_EDGE_BETS = 50;

const implied = (american: number) => (american < 0 ? -american / (100 - american) : 100 / (american + 100));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function stats(label: string, rows: ConfidenceSample[]): GradeStats {
  const edge = rows.filter((r) => r.priceAmerican !== null && r.archr > implied(r.priceAmerican));
  const profits = edge.map((r) => (r.won ? americanToDecimal(r.priceAmerican!) - 1 : -1));
  const roi = mean(profits);
  const sd = profits.length > 1 ? Math.sqrt(profits.reduce((a, v) => a + (v - roi) ** 2, 0) / (profits.length - 1)) : Infinity;
  const half = 1.96 * (sd / Math.sqrt(profits.length));
  return {
    label,
    n: rows.length,
    meanArchr: mean(rows.map((r) => r.archr)),
    hitRate: mean(rows.map((r) => r.won)),
    brier: mean(rows.map((r) => (r.archr - r.won) ** 2)),
    edgeBets: edge.length,
    edgeRoi: roi,
    edgeRoiLow: roi - half,
    edgeRoiHigh: roi + half,
  };
}

export function gradeOfSample(s: ConfidenceSample): ConfidenceGrade {
  return confidenceOf({ archr: s.archr, marketChance: s.marketChance, priceAmerican: s.priceAmerican, rate: s.rate, sampleGames: s.sampleGames, minutes: s.minutes ?? null, z: s.z ?? null, side: s.side, sport: s.sport })!.grade;
}

export function validateConfidence(samples: ConfidenceSample[]): ConfidenceValidation {
  const graded = samples.map((s) => ({ s, g: gradeOfSample(s) }));
  const by = (gs: ConfidenceGrade[]) => graded.filter((x) => gs.includes(x.g)).map((x) => x.s);
  const grades = (["A", "B", "C", "D"] as ConfidenceGrade[]).map((g) => stats(g, by([g])));
  const high = stats("A+B", by(["A", "B"]));
  const low = stats("C+D", by(["C", "D"]));
  const base = { n: samples.length, grades, high, low };
  if (high.n < MIN_POOLED || low.n < MIN_POOLED || high.edgeBets < MIN_EDGE_BETS || low.edgeBets < MIN_EDGE_BETS)
    return { ...base, verdict: "data-required", reason: `A+B ${high.n} (${high.edgeBets} edge bets), C+D ${low.n} (${low.edgeBets}): each needs ${MIN_POOLED}+ sides and ${MIN_EDGE_BETS}+ edge bets` };
  const accurate = high.brier <= low.brier;
  const pays = high.edgeRoi > low.edgeRoi;
  const f = (x: number) => x.toFixed(4);
  const r = (x: number) => `${(x * 100).toFixed(1)}%`;
  const detail = `Brier A+B ${f(high.brier)} vs C+D ${f(low.brier)}; edge-bet ROI A+B ${r(high.edgeRoi)} vs C+D ${r(low.edgeRoi)}`;
  if (accurate && pays) return { ...base, verdict: "validated", reason: `higher grades read more accurately and their edges paid more (${detail})` };
  const why = [!accurate && "ARCHR wasn't more accurate in the higher grades", !pays && "their edges didn't pay more"].filter(Boolean).join(" and ");
  return { ...base, verdict: "not-validated", reason: `${why} (${detail})` };
}
