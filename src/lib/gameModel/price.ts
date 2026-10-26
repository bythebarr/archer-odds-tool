/**
 * The game model's read on every market, priced the same way as props
 * (propModel/price.ts): model chance → blended with the books' no-vig
 * consensus by the fitted weight → EV of the best price on each side.
 */
import { calculateEv } from "@/lib/odds/devig";
import type { TwoSidedQuote } from "@/lib/odds/marketValue";
import { DEFAULT_MODEL_WEIGHT, finalProbOver, marketRead, type MarketRead } from "@/lib/propModel/market";
import { pHomeCover, pHomeWin, pOver, type ScoreDist } from "./scoreDist";

export type GameMarket = "ml" | "spread" | "total";

export interface MarketQuotes {
  /** Spread: the home team's number; total: the total; moneyline: null. */
  point: number | null;
  /** Every book pricing both sides at that number; side A = home (or Over). */
  pairs: TwoSidedQuote[];
  bestA: { priceAmerican: number; bookKey: string; bookName: string } | null;
  bestB: { priceAmerican: number; bookKey: string; bookName: string } | null;
}

export interface PricedMarket {
  market: GameMarket;
  point: number | null;
  /** The model alone, side A (home / Over). */
  modelProbA: number;
  marketRead: MarketRead | null;
  modelWeight: number;
  weightFitted: boolean;
  probA: number;
  evA: number | null;
  evB: number | null;
  bestA: MarketQuotes["bestA"];
  bestB: MarketQuotes["bestB"];
}

export function modelProbA(dist: ScoreDist, market: GameMarket, point: number | null): number | null {
  if (market === "ml") return pHomeWin(dist);
  if (point === null) return null;
  return market === "spread" ? pHomeCover(dist, point) : pOver(dist, point);
}

export function priceGameMarket(dist: ScoreDist, market: GameMarket, quotes: MarketQuotes, fittedWeight?: number): PricedMarket | null {
  const pModel = modelProbA(dist, market, quotes.point);
  if (pModel === null) return null;
  const read = marketRead(quotes.pairs);
  const modelWeight = fittedWeight ?? DEFAULT_MODEL_WEIGHT;
  const probA = finalProbOver(pModel, read, modelWeight);
  return {
    market,
    point: quotes.point,
    modelProbA: pModel,
    marketRead: read,
    modelWeight,
    weightFitted: fittedWeight !== undefined,
    probA,
    evA: quotes.bestA ? calculateEv(probA, quotes.bestA.priceAmerican) : null,
    evB: quotes.bestB ? calculateEv(1 - probA, quotes.bestB.priceAmerican) : null,
    bestA: quotes.bestA,
    bestB: quotes.bestB,
  };
}
