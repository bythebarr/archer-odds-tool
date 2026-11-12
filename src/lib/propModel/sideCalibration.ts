/**
 * The NBA side correction (fitted and checked by scripts/fit-side-calibration,
 * the math in lib/audit/sideCalibration). The 2026-11-12 factor audit found
 * ARCHR's NBA prop chance ran high on the side it leans: +5.9 pts on main
 * lines (+7.3 on overs) and +11.3 on alt rungs. In over-terms:
 *
 *   logit(p′over) = anchor + k · (logit(p_over) − anchor) + δ
 *
 * anchor is the books' no-vig over chance on a main line, even on a one-sided
 * alt rung. Client-safe and pure.
 */
import { calculateEv } from "@/lib/odds/devig";
import type { PricedProp } from "./price";

export interface SideFit {
  /** How much of ARCHR's lean away from the anchor to keep. */
  k: number;
  /** A shift toward unders (< 0) or overs, in logit. */
  delta: number;
}

export const IDENTITY: SideFit = { k: 1, delta: 0 };

/**
 * Main lines with a market read. Fitted by fit:side-calibration on 3,686
 * settled NBA main-line leans (Model lab run #83). Fitted on the earlier half,
 * judged on the later half it never saw: log loss 0.6983 → 0.6862, Brier
 * 0.2511 → 0.2465, bias +5.9 → 0.0 pts, edge-bet ROI −5.6% → +1.5% (726 bets).
 *
 * What it says: k ≈ 0 — on NBA main lines, where the projection disagrees with
 * the books' no-vig price the books have been right; what holds up is a steady
 * tilt toward the under (δ ≈ −4 pts at even money).
 */
export const NBA_MAIN_FIT: SideFit = { k: 0.05, delta: -0.16 };

/**
 * Alt rungs (one-sided, no market). Fitted on 1,661 settled alt leans; on
 * the later half, log loss 0.6176 → 0.5908, bias +11.3 → −0.6 pts.
 */
export const NBA_ALT_FIT: SideFit = { k: 1.05, delta: -0.52 };

const clamp = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));
const logit = (p: number) => Math.log(clamp(p) / (1 - clamp(p)));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** The corrected chance of the over. */
export function correctOver(pOver: number, mOver: number | null, f: SideFit): number {
  const anchor = mOver === null ? 0 : logit(mOver);
  return sigmoid(anchor + f.k * (logit(pOver) - anchor) + f.delta);
}

/** A side's chance, corrected (side-terms in, side-terms out). */
export function correctSide(pSide: number, mSide: number | null, side: "over" | "under", f: SideFit): number {
  const over = side === "over";
  const p = correctOver(over ? pSide : 1 - pSide, mSide === null ? null : over ? mSide : 1 - mSide, f);
  return over ? p : 1 - p;
}

/**
 * An NBA main-line price with the correction applied: only where the books
 * have a market read at the number (the fit's anchor). The uncorrected blend
 * is kept for refits and for selection rules tuned on it.
 */
export function correctNbaPriced(p: PricedProp, overPrice: number | null, underPrice: number | null, f: SideFit = NBA_MAIN_FIT): PricedProp {
  if (!p.market) return p;
  const probOver = correctOver(p.probOver, p.market.probOver, f);
  return {
    ...p,
    uncorrectedProbOver: p.probOver,
    probOver,
    probUnder: 1 - probOver,
    evOver: overPrice !== null ? calculateEv(probOver, overPrice) : null,
    evUnder: underPrice !== null ? calculateEv(1 - probOver, underPrice) : null,
  };
}
