/**
 * Which of ARCHR's edges hold up. The settled leans (types.ts), cut into
 * segments — by sport and market, stat, side, how big the edge was, how sure
 * ARCHR was, the price, priced or number-only — each scored four ways:
 *
 *   - hit rate against ARCHR's own average chance (calibration: does 60%
 *     mean 60%?)
 *   - ROI: a flat unit on every lean at its captured price (−110 where the
 *     book had only posted the number), with its 95% range
 *   - CLV: how far the market's no-vig chance moved toward the lean between
 *     capture and the close; the steadiest early sign of a real edge, since
 *     it needs far fewer bets than profit to read
 *   - skill: Brier score against the market's own chance at capture (above 0
 *     = ARCHR's chances were closer to what happened than the market's)
 *
 * and given a verdict: working (profit's range clears 0), not working (its
 * range is all below 0), beating the close / losing to the close (no verdict
 * on profit yet, but the line moved with or against ARCHR over 100+ leans),
 * unproven, or too early (fewer than MIN_LEANS). Pure.
 */
import { americanToDecimal } from "@/lib/odds/americanOdds";
import type { GradedLean, LeanFeatures } from "./types";

/** Fewer graded leans than this and a segment gets no verdict. */
export const MIN_LEANS = 30;
/** CLV needs this many before it can carry a verdict on its own. */
const MIN_CLV = 100;
const Z = 1.96;

export type Verdict = "working" | "not working" | "beating the close" | "losing to the close" | "unproven" | "too early";

export interface SegmentStats {
  key: string;
  label: string;
  n: number;
  hits: number;
  hitRate: number;
  /** ARCHR's average chance on these leans. */
  expected: number;
  roi: number;
  roiLow: number;
  roiHigh: number;
  /** Mean move of the market's chance toward the lean, capture to close (probability points); null without closing quotes. */
  clv: number | null;
  clvN: number;
  /** Share of leans the close moved toward. */
  beatClose: number | null;
  /** Market's Brier minus ARCHR's: above 0, ARCHR was closer. */
  skill: number | null;
  verdict: Verdict;
}

export interface Dimension {
  key: string;
  label: string;
  segments: SegmentStats[];
}

const implied = (american: number) => (american < 0 ? -american / (100 - american) : 100 / (american + 100));
/** The market's chance on the lean at capture: its no-vig read, else the price's implied chance, else even. */
const baseProb = (f: LeanFeatures) => f.marketProb ?? (f.price !== null ? implied(f.price) : 0.5);
const profitOf = (l: GradedLean) => (l.result === "hit" ? americanToDecimal(l.features.price ?? -110) - 1 : -1);

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function se(xs: number[]): number {
  if (xs.length < 2) return Infinity;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) / xs.length);
}

export function scoreSegment(key: string, label: string, leans: GradedLean[]): SegmentStats {
  const graded = leans.filter((l) => l.result === "hit" || l.result === "miss");
  const n = graded.length;
  const hits = graded.filter((l) => l.result === "hit").length;
  const profits = graded.map(profitOf);
  const roi = n ? mean(profits) : 0;
  const roiSe = se(profits);
  const withClose = graded.filter((l) => l.closingProb !== null);
  const moves = withClose.map((l) => l.closingProb! - baseProb(l.features));
  const clv = moves.length ? mean(moves) : null;
  const clvSe = se(moves);
  const brier = (p: number, hit: boolean) => (p - (hit ? 1 : 0)) ** 2;
  const skill = n ? mean(graded.map((l) => brier(baseProb(l.features), l.result === "hit") - brier(l.prob, l.result === "hit"))) : null;

  let verdict: Verdict = "unproven";
  if (n < MIN_LEANS) verdict = "too early";
  else if (roi - Z * roiSe > 0) verdict = "working";
  else if (roi + Z * roiSe < 0) verdict = "not working";
  else if (clv !== null && moves.length >= MIN_CLV && clv - Z * clvSe > 0) verdict = "beating the close";
  else if (clv !== null && moves.length >= MIN_CLV && clv + Z * clvSe < 0) verdict = "losing to the close";

  return {
    key,
    label,
    n,
    hits,
    hitRate: n ? hits / n : 0,
    expected: n ? mean(graded.map((l) => l.prob)) : 0,
    roi,
    roiLow: n ? roi - Z * roiSe : 0,
    roiHigh: n ? roi + Z * roiSe : 0,
    clv,
    clvN: moves.length,
    beatClose: moves.length ? moves.filter((m) => m > 0).length / moves.length : null,
    skill,
    verdict,
  };
}

const SPORT = { nba: "NBA", nfl: "NFL" } as const;
const KIND = { prop: "props", ml: "moneylines", spread: "spreads", total: "totals" } as const;
const titleCase = (s: string) => s.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

/** Bucketed segments: [label, test] in display order. */
const EDGE_BUCKETS: [string, (e: number) => boolean][] = [
  ["Edge below 0 (market more confident)", (e) => e < 0],
  ["Edge 0–2 pts", (e) => e >= 0 && e < 0.02],
  ["Edge 2–5 pts", (e) => e >= 0.02 && e < 0.05],
  ["Edge 5–10 pts", (e) => e >= 0.05 && e < 0.1],
  ["Edge 10+ pts", (e) => e >= 0.1],
];
const CONFIDENCE_BUCKETS: [string, (p: number) => boolean][] = [
  ["ARCHR under 50%", (p) => p < 0.5],
  ["ARCHR 50–55%", (p) => p >= 0.5 && p < 0.55],
  ["ARCHR 55–60%", (p) => p >= 0.55 && p < 0.6],
  ["ARCHR 60–65%", (p) => p >= 0.6 && p < 0.65],
  ["ARCHR 65%+", (p) => p >= 0.65],
];
const PRICE_BUCKETS: [string, (v: number) => boolean][] = [
  ["−200 or shorter", (v) => v <= -200],
  ["−199 to −131", (v) => v > -200 && v <= -131],
  ["−130 to +129", (v) => v > -131 && v < 130],
  ["+130 to +199", (v) => v >= 130 && v < 200],
  ["+200 or longer", (v) => v >= 200],
];

/** Every dimension, every segment with at least one lean; the largest segments first within a free-form dimension. */
export function evaluateLeans(leans: GradedLean[]): { overall: SegmentStats; dimensions: Dimension[] } {
  const groupBy = (key: (l: GradedLean) => string | null, label: (k: string) => string) => {
    const groups = new Map<string, GradedLean[]>();
    for (const l of leans) {
      const k = key(l);
      if (k !== null) (groups.get(k) ?? groups.set(k, []).get(k)!).push(l);
    }
    return [...groups].map(([k, list]) => scoreSegment(k, label(k), list)).sort((a, b) => b.n - a.n);
  };
  const buckets = <T,>(defs: [string, (v: T) => boolean][], value: (l: GradedLean) => T | null) =>
    defs.flatMap(([label, test]) => {
      const list = leans.filter((l) => {
        const v = value(l);
        return v !== null && test(v);
      });
      return list.length ? [scoreSegment(label, label, list)] : [];
    });

  const market = (l: GradedLean) => `${SPORT[l.features.sport]} ${KIND[l.features.kind]}`;
  return {
    overall: scoreSegment("all", "Every lean", leans),
    dimensions: [
      { key: "market", label: "Sport and market", segments: groupBy(market, (k) => k) },
      {
        key: "stat",
        label: "Prop stat",
        segments: groupBy((l) => (l.features.kind === "prop" ? `${SPORT[l.features.sport]} ${titleCase(l.features.stat)}` : null), (k) => k),
      },
      { key: "side", label: "Side", segments: groupBy((l) => `${market(l)} · ${l.features.side}`, (k) => k) },
      { key: "edge", label: "Edge over the market at capture", segments: buckets(EDGE_BUCKETS, (l) => l.prob - baseProb(l.features)) },
      { key: "confidence", label: "ARCHR's chance", segments: buckets(CONFIDENCE_BUCKETS, (l) => l.prob) },
      { key: "price", label: "Price", segments: buckets(PRICE_BUCKETS, (l) => l.features.price) },
      {
        key: "source",
        label: "Line source",
        segments: groupBy((l) => (l.features.priced ? "Book-priced" : "Book's number, no price (read at −110)"), (k) => k),
      },
      {
        key: "standout",
        label: "NBA Hottest Tonight",
        segments: groupBy((l) => (l.features.standout === undefined ? null : l.features.standout ? "Made the page" : "Didn't make the page"), (k) => k),
      },
    ].filter((d) => d.segments.length > 0),
  };
}
