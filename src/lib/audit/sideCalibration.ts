/**
 * Side calibration: the factor audit (2026-11-12) found ARCHR's NBA prop
 * chances run high on the side it leans, overs most (+8 pts) and alt rungs
 * worst (+12). This fits the smallest correction that could fix that, in
 * over-terms so one rule serves both sides:
 *
 *   logit(p′over) = anchor + k · (logit(p_over) − anchor) + δ
 *
 *   anchor  the books' no-vig over chance where there is one (main lines),
 *           else even (alt rungs: one-sided, no market to lean on)
 *   k       how much of ARCHR's lean away from the anchor to keep (k < 1
 *           tames the winner's curse: the side ARCHR picks is the side it
 *           overrates)
 *   δ       a shift toward unders (δ < 0) or overs — a projection that runs
 *           hot on overs
 *
 * Fitted by log loss on the EARLIER half of graded leans and judged on the
 * LATER half it never saw: a correction only ships if the later half reads
 * more accurately with it, by more than noise (MIN_GAIN). Pure; scripts/fit-side-calibration supplies leans.
 */
import { americanToDecimal } from "@/lib/odds/americanOdds";

export interface SideSample {
  /** ARCHR's chance of the over. */
  pOver: number;
  /** The books' no-vig over chance; null on one-sided (alt) rungs. */
  mOver: number | null;
  side: "over" | "under";
  /** The price taken on `side`, for edge-bet ROI; null without one. */
  price: number | null;
  /** Whether the over hit. */
  overHit: 0 | 1;
  date: string;
}

export { IDENTITY, correctOver, type SideFit } from "@/lib/propModel/sideCalibration";
import { IDENTITY, correctOver, type SideFit } from "@/lib/propModel/sideCalibration";

const clamp = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));
const implied = (american: number) => (american < 0 ? -american / (100 - american) : 100 / (american + 100));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export interface SideStats {
  n: number;
  logLoss: number;
  brier: number;
  /** Mean chance on the leaned side minus its hit rate (+ = runs high). */
  bias: number;
  /** Overs only, the same. */
  overBias: number;
  edgeBets: number;
  roi: number | null;
}

export function sideStats(rows: SideSample[], f: SideFit = IDENTITY): SideStats {
  const ps = rows.map((r) => correctOver(r.pOver, r.mOver, f));
  const side = rows.map((r, i) => ({ p: r.side === "over" ? ps[i] : 1 - ps[i], won: r.side === "over" ? r.overHit : 1 - r.overHit, r }));
  const overs = side.filter((s) => s.r.side === "over");
  const edge = side.filter((s) => s.r.price !== null && s.p > implied(s.r.price));
  return {
    n: rows.length,
    logLoss: mean(rows.map((r, i) => -(r.overHit ? Math.log(clamp(ps[i])) : Math.log(1 - clamp(ps[i]))))),
    brier: mean(rows.map((r, i) => (ps[i] - r.overHit) ** 2)),
    bias: mean(side.map((s) => s.p)) - mean(side.map((s) => s.won)),
    overBias: overs.length ? mean(overs.map((s) => s.p)) - mean(overs.map((s) => s.won)) : NaN,
    edgeBets: edge.length,
    roi: edge.length ? mean(edge.map((s) => (s.won ? americanToDecimal(s.r.price!) - 1 : -1))) : null,
  };
}

/** Grid search for the (k, δ) with the lowest log loss. */
export function fitSide(rows: SideSample[]): SideFit {
  let best = IDENTITY;
  let bestLoss = sideStats(rows, IDENTITY).logLoss;
  for (let k = 0; k <= 1.3001; k += 0.05) {
    for (let delta = -0.8; delta <= 0.4001; delta += 0.02) {
      const f = { k: Math.round(k * 100) / 100, delta: Math.round(delta * 100) / 100 };
      const loss = sideStats(rows, f).logLoss;
      if (loss < bestLoss - 1e-12) {
        best = f;
        bestLoss = loss;
      }
    }
  }
  return best;
}

export interface SideCheck {
  fit: SideFit;
  /** The later half, as shown today and with the earlier half's fit. */
  before: SideStats;
  after: SideStats;
  /** The fit from all of it, to ship if the check passes. */
  full: SideFit;
  verdict: "improves" | "no better" | "too few";
}

/** Fewer graded leans than this in either half: no verdict. */
export const MIN_HALF = 150;
/** The later half's log loss must drop by at least this much (nats per bet): less is noise an honest model also shows. */
export const MIN_GAIN = 0.002;

export function checkSide(rows: SideSample[]): SideCheck {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const mid = Math.ceil(sorted.length / 2);
  const early = sorted.slice(0, mid);
  const late = sorted.slice(mid);
  const fit = early.length ? fitSide(early) : IDENTITY;
  const before = sideStats(late, IDENTITY);
  const after = sideStats(late, fit);
  const verdict = early.length < MIN_HALF || late.length < MIN_HALF ? "too few" : before.logLoss - after.logLoss >= MIN_GAIN && after.brier <= before.brier ? "improves" : "no better";
  return { fit, before, after, full: fitSide(sorted), verdict };
}
