/**
 * Fitting the model's weight against the market (see market.ts) from graded
 * props: the weight whose blended probabilities have the lowest log loss.
 * Pure, so the backtest scripts and tests share it.
 */
import { blendWithMarket } from "./market";

export interface BlendSample {
  /** The model's calibrated chance of the Over. */
  pModel: number;
  /** The market's no-vig chance of the Over at the same number. */
  pMarket: number;
  /** 1 if the Over cashed (pushes are dropped before fitting). */
  won: 0 | 1;
}

export interface BlendFit {
  modelWeight: number;
  blendLogLoss: number;
  modelLogLoss: number;
  marketLogLoss: number;
  n: number;
}

function logLossOf(samples: BlendSample[], prob: (s: BlendSample) => number): number {
  let sum = 0;
  for (const s of samples) {
    const p = Math.min(Math.max(prob(s), 1e-6), 1 - 1e-6);
    sum -= s.won ? Math.log(p) : Math.log(1 - p);
  }
  return samples.length ? sum / samples.length : NaN;
}

/** Grid-searches the model's weight in [0, 1] (step 0.05). */
export function fitModelWeight(samples: BlendSample[]): BlendFit {
  let best = { w: 0, ll: Infinity };
  for (let i = 0; i <= 20; i++) {
    const w = i / 20;
    const ll = logLossOf(samples, (s) => blendWithMarket(s.pModel, s.pMarket, w));
    if (ll < best.ll - 1e-9) best = { w, ll };
  }
  return {
    modelWeight: best.w,
    blendLogLoss: best.ll,
    modelLogLoss: logLossOf(samples, (s) => s.pModel),
    marketLogLoss: logLossOf(samples, (s) => s.pMarket),
    n: samples.length,
  };
}
