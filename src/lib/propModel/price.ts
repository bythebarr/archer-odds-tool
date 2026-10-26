/**
 * The pricing pipeline every sport's prop model runs through, in order:
 *
 *   1. projection → distribution → raw chance of the Over   (sport-specific)
 *   2. calibration: logit shrink fitted by the sport's backtest
 *   3. injury: out/doubtful withholds the model; questionable widens it
 *   4. market blend: weighted with the de-vigged consensus (see market.ts)
 *   5. EV of the best price on each side at that probability
 *
 * Steps 2–5 live here so a new sport only writes step 1.
 */
import { calculateEv } from "@/lib/odds/devig";
import type { TwoSidedQuote } from "@/lib/odds/marketValue";
import { injuryShrink, type InjuryLevel } from "@/lib/injuries/status";
import { shrinkLogit } from "./distribution";
import { DEFAULT_MODEL_WEIGHT, finalProbOver, marketRead, type MarketRead } from "./market";

export interface PricedProp {
  /** The model alone, calibrated and injury-adjusted, before the market blend. */
  modelProbOver: number;
  /** The market's no-vig read at this number; null when too few books price both sides. */
  market: MarketRead | null;
  /** The model's weight in the blend (0–1). */
  modelWeight: number;
  /** True when the weight came from a backtest fit, false while the default holds. */
  weightFitted: boolean;
  probOver: number;
  probUnder: number;
  /** EV of the best price on each side at the blended probability. */
  evOver: number | null;
  evUnder: number | null;
}

/** Out or doubtful: the player probably sits, and no projection is offered. */
export function modelWithheld(injury: InjuryLevel | null | undefined): boolean {
  return injury === "out" || injury === "doubtful";
}

export function priceProp(opts: {
  rawProbOver: number;
  calibrationShrink: number;
  injury?: InjuryLevel | null;
  pairs: TwoSidedQuote[];
  /** The fitted weight for this stat; omitted → DEFAULT_MODEL_WEIGHT. */
  modelWeight?: number;
  overPrice: number | null;
  underPrice: number | null;
}): PricedProp {
  const calibrated = shrinkLogit(opts.rawProbOver, opts.calibrationShrink);
  const modelProbOver = 0.5 + (calibrated - 0.5) * injuryShrink(opts.injury ?? null);
  const market = marketRead(opts.pairs);
  const modelWeight = opts.modelWeight ?? DEFAULT_MODEL_WEIGHT;
  const probOver = finalProbOver(modelProbOver, market, modelWeight);
  return {
    modelProbOver,
    market,
    modelWeight,
    weightFitted: opts.modelWeight !== undefined,
    probOver,
    probUnder: 1 - probOver,
    evOver: opts.overPrice !== null ? calculateEv(probOver, opts.overPrice) : null,
    evUnder: opts.underPrice !== null ? calculateEv(1 - probOver, opts.underPrice) : null,
  };
}
