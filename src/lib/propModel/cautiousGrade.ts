/**
 * Grading the haircut: on graded props, which predicts outcomes best?
 *
 *   BLEND    — ARCHR Chance alone (the blend out of priceProp)
 *   LEGACY   — the old cautious read, min(blend, Wilson floor of the record)
 *   EVIDENCE — the new cautious read, the record as a Beta update on the
 *              blend, games weighted by role resemblance where known
 *              (lib/propModel/cautiousRead)
 *
 * All three are scored on the SAME samples (log loss, Brier, mean predicted
 * vs actual). Then, for each cautious read, samples are bucketed by its
 * cautious edge — ≤0, 0–5%, 5–10%, 10–20%, 20%+ up to the +50% trust cap, and
 * the distrusted tail past it — with each bucket's hit rate against the chance
 * its price implied and its flat-stake ROI at that price. The prices are the
 * closing quotes, so "hit rate above implied" IS "beat the closing price".
 *
 * evidenceGate() turns a grade into the one decision the canonical module's
 * CAUTIOUS_READ_MODE waits on. Pure and DB-free: scripts/backtest-cautious-edge
 * supplies the graded samples, the unit tests synthetic ones.
 *
 * Audit reconciliation (Nov 9, F1/F6): every read is scored on the SAME sample
 * set — never one read on all samples and another on a subset — and the
 * one-line verdict's wash band is ±2 paired standard errors of the per-sample
 * log-loss difference (deltaSe), so it widens as the sample shrinks instead
 * of pretending a fixed 0.002 means the same thing at n=50 and n=5,000.
 */
import { americanToDecimal } from "@/lib/odds/americanOdds";
import { MAX_TRUSTED_RELATIVE_EDGE, relativeEdge } from "@/lib/builder/conservative";
import type { Rate } from "@/lib/builder/types";
import { cautiousChance, type CautiousReadMode } from "./canonical";
import { evidenceCautiousChance } from "./cautiousRead";

export interface CautiousGradeSample {
  /** ARCHR Chance for the graded side (the blend out of priceProp). */
  pBlend: number;
  /** The side's plain hit record going into the game — [hits, games] over the L10 window (the screener's window). */
  rate: Rate;
  /** The same window weighted by role resemblance to that night (NBA); null/absent = no role context, the plain record is used. */
  roleRate?: Rate | null;
  /** Closing best price for the side, American; null = no price, so no cautious edge and no ROI. */
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
  /** Mean closing-price implied chance — what the bucket's props "should" have hit at their prices. */
  meanImplied: number;
  /** Actual hit rate: above meanImplied = beat the closing price. */
  hitRate: number;
  /** Flat one-unit stake on every prop in the bucket at its closing price: mean profit per unit, with its 95% range. */
  roi: number;
  roiLow: number;
  roiHigh: number;
  blendLogLoss: number;
  /** Log loss of the read that bucketed these samples. */
  readLogLoss: number;
}

export interface CautiousGrade {
  n: number;
  /** Samples with a closing price (the subset buckets and ROI cover). */
  pricedN: number;
  /** Samples whose record carried role weighting. */
  roleWeightedN: number;
  /** Every read scored on all n samples. */
  blend: ProbScore;
  legacy: ProbScore;
  evidence: ProbScore;
  /** The evidence read on the plain record (no role weighting): isolates what the role weighting adds. */
  evidencePlain: ProbScore;
  /**
   * Standard error of the paired per-sample log-loss difference (legacy −
   * blend) across the scored samples; NaN below 2 samples. The verdict's wash
   * band is ±2× this (audit F6), so it is sample-size aware by construction.
   */
  deltaSe: number;
  /** Buckets by each cautious read's own edge, priced samples only. */
  buckets: Record<CautiousReadMode, CautiousBucket[]>;
  /** Diagnostics only — the evidence read's log loss at other prior strengths. Never applied automatically. */
  priorSweep: { priorGames: number; logLoss: number; brier: number }[];
}

const EPS = 1e-6;
const Z = 1.96;
const clampP = (p: number) => Math.min(Math.max(p, EPS), 1 - EPS);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

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
    meanProb: mean(pairs.map((x) => x.p)),
    hitRate: mean(pairs.map((x) => x.won)),
  };
}

const implied = (american: number) => (american < 0 ? -american / (100 - american) : 100 / (american + 100));

export const CAUTIOUS_BUCKETS: { key: string; label: string; test: (e: number) => boolean }[] = [
  { key: "le0", label: "≤ 0%", test: (e) => e <= 0 },
  { key: "0-5", label: "0–5%", test: (e) => e > 0 && e <= 0.05 },
  { key: "5-10", label: "5–10%", test: (e) => e > 0.05 && e <= 0.1 },
  { key: "10-20", label: "10–20%", test: (e) => e > 0.1 && e <= 0.2 },
  { key: "20+", label: "20%+ (to the +50% cap)", test: (e) => e > 0.2 && e <= MAX_TRUSTED_RELATIVE_EDGE },
  { key: "distrusted", label: "> 50% (distrusted)", test: (e) => e > MAX_TRUSTED_RELATIVE_EDGE },
];

/** The prior strengths the sweep reports. */
export const PRIOR_SWEEP = [5, 10, 20, 40];

const readOf = (s: CautiousGradeSample, mode: CautiousReadMode) => cautiousChance(s.pBlend, s.rate, s.roleRate, mode)!;

function bucketsFor(samples: CautiousGradeSample[], mode: CautiousReadMode): CautiousBucket[] {
  const priced = samples.flatMap((s) => {
    if (s.priceAmerican === null) return [];
    const p = readOf(s, mode);
    const e = relativeEdge(p, s.priceAmerican);
    return e === null ? [] : [{ s, p, e, price: s.priceAmerican }];
  });
  return CAUTIOUS_BUCKETS.map((b) => {
    const rows = priced.filter((x) => b.test(x.e));
    const profits = rows.map((x) => (x.s.won ? americanToDecimal(x.price) - 1 : -1));
    const roi = mean(profits);
    const sd = profits.length > 1 ? Math.sqrt(profits.reduce((a, v) => a + (v - roi) ** 2, 0) / (profits.length - 1)) : Infinity;
    const half = Z * (sd / Math.sqrt(profits.length));
    return {
      key: b.key,
      label: b.label,
      n: rows.length,
      meanCautiousEdge: mean(rows.map((x) => x.e)),
      meanImplied: mean(rows.map((x) => implied(x.price))),
      hitRate: mean(rows.map((x) => x.s.won)),
      roi,
      roiLow: roi - half,
      roiHigh: roi + half,
      blendLogLoss: logLossOf(rows.map((x) => ({ p: x.s.pBlend, won: x.s.won }))),
      readLogLoss: logLossOf(rows.map((x) => ({ p: x.p, won: x.s.won }))),
    };
  });
}

export function gradeCautiousSamples(samples: CautiousGradeSample[]): CautiousGrade {
  const pairs = (p: (s: CautiousGradeSample) => number) => samples.map((s) => ({ p: p(s), won: s.won }));
  const evidenceAt = (k: number) => (s: CautiousGradeSample) => evidenceCautiousChance(s.pBlend, s.roleRate ?? s.rate, k)!;
  // Paired log-loss differences (legacy − blend) per sample → SE of the mean (audit F6).
  const llOf = (p: number, won: 0 | 1) => -(won ? Math.log(clampP(p)) : Math.log(1 - clampP(p)));
  const diffs = samples.map((s) => llOf(readOf(s, "legacy-min"), s.won) - llOf(s.pBlend, s.won));
  let deltaSe = NaN;
  if (diffs.length >= 2) {
    const m = mean(diffs);
    deltaSe = Math.sqrt(diffs.reduce((a, v) => a + (v - m) ** 2, 0) / (diffs.length - 1) / diffs.length);
  }
  return {
    n: samples.length,
    pricedN: samples.filter((s) => s.priceAmerican !== null).length,
    roleWeightedN: samples.filter((s) => s.roleRate).length,
    blend: score(pairs((s) => s.pBlend)),
    legacy: score(pairs((s) => readOf(s, "legacy-min"))),
    evidence: score(pairs((s) => readOf(s, "evidence"))),
    evidencePlain: score(pairs((s) => cautiousChance(s.pBlend, s.rate, null, "evidence")!)),
    deltaSe,
    buckets: { "legacy-min": bucketsFor(samples, "legacy-min"), evidence: bucketsFor(samples, "evidence") },
    priorSweep: PRIOR_SWEEP.map((k) => {
      const sc = score(pairs(evidenceAt(k)));
      return { priorGames: k, logLoss: sc.logLoss, brier: sc.brier };
    }),
  };
}

/** Fewer graded samples than this and the gate won't decide: the log-loss gaps it compares are noise below it. */
export const MIN_GATE_SAMPLES = 300;

export type GateDecision = "adopt-evidence" | "keep-legacy" | "data-required";

/**
 * The evidence gate. The evidence read replaces the legacy min() as the
 * screener/optimizer input only if it calibrates at least as well as the blend
 * alone (log loss AND Brier no worse) and better than the legacy read (log
 * loss strictly lower). Below MIN_GATE_SAMPLES graded samples: no decision.
 */
export function evidenceGate(g: CautiousGrade): { decision: GateDecision; reason: string } {
  if (g.n < MIN_GATE_SAMPLES) {
    return { decision: "data-required", reason: `${g.n} graded props; the gate needs at least ${MIN_GATE_SAMPLES}` };
  }
  const f = (x: number) => x.toFixed(4);
  const vsBlend = g.evidence.logLoss <= g.blend.logLoss && g.evidence.brier <= g.blend.brier;
  const vsLegacy = g.evidence.logLoss < g.legacy.logLoss;
  const detail = `evidence LL ${f(g.evidence.logLoss)} / Brier ${f(g.evidence.brier)}; blend ${f(g.blend.logLoss)} / ${f(g.blend.brier)}; legacy LL ${f(g.legacy.logLoss)}`;
  if (vsBlend && vsLegacy) return { decision: "adopt-evidence", reason: `passes: at least as calibrated as the blend and better than legacy min() (${detail})` };
  const why = [!vsBlend && "worse than the blend alone", !vsLegacy && "no better than legacy min()"].filter(Boolean).join(" and ");
  return { decision: "keep-legacy", reason: `fails: ${why} (${detail})` };
}

/**
 * One-line verdict for the lab output: how the legacy haircut compares with
 * the blend, by log loss. The wash band is ±2 paired standard errors of the
 * per-sample difference (audit F6): sample-size aware, and with too few
 * samples to estimate it, nothing is decisive.
 */
export function cautiousVerdict(g: CautiousGrade): string {
  if (!g.n) return "no graded samples — nothing to grade";
  const d = g.legacy.logLoss - g.blend.logLoss;
  const band = Number.isFinite(g.deltaSe) ? 2 * g.deltaSe : Infinity;
  if (Math.abs(d) <= band)
    return `a wash on log loss (Δ ${d >= 0 ? "+" : ""}${d.toFixed(4)}, inside the ±${Number.isFinite(band) ? band.toFixed(4) : "∞"} noise band at n=${g.n}) — the min() haircut neither earns nor costs accuracy at this sample`;
  return d < 0
    ? `the min() haircut predicted BETTER than the blend (log loss ${g.legacy.logLoss.toFixed(4)} vs ${g.blend.logLoss.toFixed(4)}, Δ ${d.toFixed(4)})`
    : `the blend predicted BETTER than its min() haircut (log loss ${g.blend.logLoss.toFixed(4)} vs ${g.legacy.logLoss.toFixed(4)}, Δ +${d.toFixed(4)}) — the haircut costs accuracy as a probability, whatever it earns as a filter`;
}
