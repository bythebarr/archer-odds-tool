/**
 * Blending the model with the market — the first rule of pricing props well.
 *
 * The de-vigged consensus of many books already carries most of what any one
 * model knows (and things it doesn't: late news, sharp money). A model earns
 * its keep by moving that number, not replacing it. So the price we act on is
 *
 *   logit(p) = w · logit(p_model) + (1 − w) · logit(p_market)
 *
 * with w (the model's weight) fitted per sport and stat by
 * `npm run backtest:props-market`, which grid-searches w for the lowest log
 * loss on graded props against the closing consensus. Until a fit has enough
 * games, DEFAULT_MODEL_WEIGHT holds — deliberately modest, since sharp prop
 * modelers rarely beat the closing market by much.
 *
 * Without a market (fewer than MIN_BOOKS pricing both sides), the model stands
 * alone but is pulled further toward 50%: an unblended number is a less
 * certain one.
 */
import { fairPrice, type TwoSidedQuote } from "@/lib/odds/marketValue";
import { shrinkLogit } from "./distribution";

export const DEFAULT_MODEL_WEIGHT = 0.35;
/** Graded props a fitted weight needs before it replaces the default. */
export const MIN_FIT_SAMPLES = 300;
/** With no market to lean on, the model's logit is scaled by this. */
const SOLO_SHRINK = 0.7;

const logit = (p: number) => {
  const c = Math.min(Math.max(p, 1e-4), 1 - 1e-4);
  return Math.log(c / (1 - c));
};

export function blendWithMarket(pModel: number, pMarket: number, modelWeight: number): number {
  const w = Math.min(Math.max(modelWeight, 0), 1);
  return 1 / (1 + Math.exp(-(w * logit(pModel) + (1 - w) * logit(pMarket))));
}

export interface MarketRead {
  /** The market's no-vig chance of the Over. */
  probOver: number;
  books: number;
}

/** The de-vigged consensus at one number (sharp books weighted up), or null below MIN_BOOKS. */
export function marketRead(pairs: TwoSidedQuote[]): MarketRead | null {
  const fair = fairPrice(pairs);
  return fair ? { probOver: fair.probA, books: fair.booksUsed } : null;
}

/** The final Over probability: blended when the market exists, shrunk when it doesn't. */
export function finalProbOver(pModel: number, market: MarketRead | null, modelWeight: number): number {
  return market ? blendWithMarket(pModel, market.probOver, modelWeight) : shrinkLogit(pModel, SOLO_SHRINK);
}
