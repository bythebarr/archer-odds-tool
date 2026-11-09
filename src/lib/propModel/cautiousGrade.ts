/**
 * Head-to-head grading of the cautious haircut (Phase 6): on graded props,
 * does replacing ARCHR Chance (the blend) with its cautious read —
 * min(blend, Wilson floor of the L10 record) — predict outcomes better or
 * worse? Pure and DB-free; scripts/backtest-cautious-edge.ts supplies the
 * graded samples, the unit tests supply synthetic ones.
 *
 * Scores BOTH probabilities head-to-head on the SAME samples — the priced
 * subset, the only ones a cautious read exists for (log loss + Brier + mean
 * predicted vs actual hit rate). The blend's all-sample score is reported
 * alongside as context (blendAll), never as the comparison: scoring the two
 * reads on different sample sets would crown whichever subset is easier.
 * Buckets samples by cautious-edge size
 * so the readout answers the practical question too: when the cautious edge
 * says a prop is strong, does it actually cash more than the price implies?
 */
import { MAX_TRUSTED_RELATIVE_EDGE } from "@/lib/builder/conservative";
import type { Rate } from "@/lib/builder/types";
import { cautiousChance, cautiousEdge } from "./canonical";

export interface CautiousGradeSample {
  /** ARCHR Chance for the graded side (the blend out of priceProp). */
  pBlend: number;
  /** The side's hit record going into the game — [hits, games] over the L10 window (the screener's window). */
  rate: Rate;
  /** Best posted price for the side, American; null = no price, so no cautious edge exists. */
  priceAmerican: number | null;
  /** 1 if the side cashed, 0 if not (pushes are excluded by the caller). */
  won: 0 | 1;
}

export interface ProbScore {
  n: number;
  logLoss: number;
  brier: number;
  /** Mean predicted chance across the scored samples. */
  meanProb: number;
  /** Actual hit rate across the scored samples. */
  hitRate: number;
}

export interface CautiousBucket {
  key: string;
  label: string;
  n: number;
  /** Mean cautious edge in the bucket. */
  meanCautiousEdge: number;
  /** Mean price-implied chance — what the bucket's props "should" have hit at their prices. */
  meanImplied: number;
  /** Actual hit rate. */
  hitRate: number;
  blendLogLoss: number;
  cautiousLogLoss: number;
}

export interface CautiousGrade {
  n: number;
  /** Samples with a price and a cautious read (the subset the cautious scores cover). */
  pricedN: number;
  /** Blend scored on the SAME priced subset as the cautious read — the headline head-to-head. */
  blend: ProbScore;
  /** Blend scored on every sample, priced or not. Context only; never the comparison. */
  blendAll: ProbScore;
  /** Scored on pricedN samples only. */
  cautious: ProbScore;
  /**
   * Standard error of the paired per-sample log-loss difference (cautious − blend)
   * on the priced subset; NaN below 2 priced samples. The verdict's wash band is
   * ±2× this, so it widens as the sample shrinks instead of pretending a fixed
   * 0.002 means the same thing at n=50 and n=5,000.
   */
  deltaSe: number;
  buckets: CautiousBucket[];
  /** Priced samples whose cautious edge ran past the +50% trust cap — shown, never silently dropped. */
  distrustedN: number;
}

const EPS = 1e-6;
const clampP = (p: number) => Math.min(Math.max(p, EPS), 1 - EPS);

function logLossOf(pairs: { p: number; won: 0 | 1 }[]): number {
  if (!pairs.length) return NaN;
  return pairs.reduce((s, x) => s - (x.won ? Math.log(clampP(x.p)) : Math.log(1 - clampP(x.p))), 0) / pairs.length;
}

function score(pairs: { p: number; won: 0 | 1 }[]): ProbScore {
  const n = pairs.length;
  return {
    n,
    logLoss: logLossOf(pairs),
    brier: n ? pairs.reduce((s, x) => s + (x.p - x.won) ** 2, 0) / n : NaN,
    meanProb: n ? pairs.reduce((s, x) => s + x.p, 0) / n : NaN,
    hitRate: n ? pairs.reduce((s, x) => s + x.won, 0) / n : NaN,
  };
}

const BUCKETS: { key: string; label: string; test: (e: number) => boolean }[] = [
  { key: "neg", label: "cautious edge ≤ 0%", test: (e) => e <= 0 },
  { key: "0-5", label: "0–5%", test: (e) => e > 0 && e <= 0.05 },
  { key: "5-10", label: "5–10%", test: (e) => e > 0.05 && e <= 0.1 },
  { key: "10-25", label: "10–25%", test: (e) => e > 0.1 && e <= 0.25 },
  { key: "25-50", label: "25–50%", test: (e) => e > 0.25 && e <= MAX_TRUSTED_RELATIVE_EDGE },
  { key: "distrusted", label: ">50% (distrusted)", test: (e) => e > MAX_TRUSTED_RELATIVE_EDGE },
];

export function gradeCautiousSamples(samples: CautiousGradeSample[]): CautiousGrade {
  const blendAll = score(samples.map((s) => ({ p: s.pBlend, won: s.won })));

  const priced = samples
    .map((s) => ({ s, cp: cautiousChance(s.pBlend, s.rate), ce: cautiousEdge(s.pBlend, s.rate, s.priceAmerican) }))
    .filter((x): x is { s: CautiousGradeSample; cp: number; ce: number } => x.cp !== null && x.ce !== null && x.s.priceAmerican !== null);

  // Head-to-head on the priced subset only: BOTH reads scored on these samples.
  const blend = score(priced.map((x) => ({ p: x.s.pBlend, won: x.s.won })));
  const cautious = score(priced.map((x) => ({ p: x.cp, won: x.s.won })));

  // Paired log-loss differences (cautious − blend) per priced sample → SE of the mean.
  const llOf = (p: number, won: 0 | 1) => -(won ? Math.log(clampP(p)) : Math.log(1 - clampP(p)));
  const diffs = priced.map((x) => llOf(x.cp, x.s.won) - llOf(x.s.pBlend, x.s.won));
  let deltaSe = NaN;
  if (diffs.length >= 2) {
    const mean = diffs.reduce((s, v) => s + v, 0) / diffs.length;
    const variance = diffs.reduce((s, v) => s + (v - mean) ** 2, 0) / (diffs.length - 1);
    deltaSe = Math.sqrt(variance / diffs.length);
  }

  const implied = (american: number) => (american < 0 ? -american / (100 - american) : 100 / (american + 100));
  const buckets: CautiousBucket[] = BUCKETS.map((b) => {
    const rows = priced.filter((x) => b.test(x.ce));
    return {
      key: b.key,
      label: b.label,
      n: rows.length,
      meanCautiousEdge: rows.length ? rows.reduce((s, x) => s + x.ce, 0) / rows.length : NaN,
      meanImplied: rows.length ? rows.reduce((s, x) => s + implied(x.s.priceAmerican!), 0) / rows.length : NaN,
      hitRate: rows.length ? rows.reduce((s, x) => s + x.s.won, 0) / rows.length : NaN,
      blendLogLoss: logLossOf(rows.map((x) => ({ p: x.s.pBlend, won: x.s.won }))),
      cautiousLogLoss: logLossOf(rows.map((x) => ({ p: x.cp, won: x.s.won }))),
    };
  });

  return {
    n: samples.length,
    pricedN: priced.length,
    blend,
    blendAll,
    cautious,
    deltaSe,
    buckets,
    distrustedN: buckets.find((b) => b.key === "distrusted")?.n ?? 0,
  };
}

/** One-line verdict for the lab output: which probability predicted better, and by how much log loss. */
export function cautiousVerdict(g: CautiousGrade): string {
  if (!g.pricedN) return "no priced samples — nothing to grade";
  const d = g.cautious.logLoss - g.blend.logLoss;
  // Wash band is ±2 paired standard errors: sample-size aware by construction.
  // With too few priced samples to estimate it, nothing is decisive.
  const band = Number.isFinite(g.deltaSe) ? 2 * g.deltaSe : Infinity;
  if (Math.abs(d) <= band) return `a wash on log loss (Δ ${d >= 0 ? "+" : ""}${d.toFixed(4)}, inside the ±${Number.isFinite(band) ? band.toFixed(4) : "∞"} noise band at n=${g.pricedN} priced) — the haircut neither earns nor costs accuracy at this sample`;
  return d < 0
    ? `the cautious read predicted BETTER than the blend (log loss ${g.cautious.logLoss.toFixed(4)} vs ${g.blend.logLoss.toFixed(4)}, Δ ${d.toFixed(4)})`
    : `the blend predicted BETTER than its cautious read (log loss ${g.blend.logLoss.toFixed(4)} vs ${g.cautious.logLoss.toFixed(4)}, Δ +${d.toFixed(4)}) — the haircut costs accuracy as a probability, whatever it earns as a filter`;
}
