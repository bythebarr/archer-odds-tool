/**
 * Provider-agnostic prop pricing. Whatever odds source is eventually chosen
 * (ParlayAPI, The Odds API, a manual entry on the page) only has to produce a
 * `PropLineQuote`; everything downstream — calibrated over/under probability,
 * de-vigged market probability, fair odds, EV — lives here and never knows
 * where the line came from.
 */
import type { FrozenModel, ServedMarket } from "./frozen";

export interface PropLineQuote {
  playerName: string;
  market: ServedMarket;
  line: number;
  overAmerican: number | null;
  underAmerican: number | null;
  book: string;
  /** Who produced the quote, e.g. "manual", "parlayapi" — recorded, never trusted as a closing line. */
  source: string;
}

export interface PricedProp {
  pOver: number;
  pUnder: number;
  fairOverAmerican: number;
  fairUnderAmerican: number;
  /** Market's de-vigged over probability, when both sides are quoted. */
  marketPOver: number | null;
  /** Expected value per unit staked at the quoted price, when quoted. */
  evOver: number | null;
  evUnder: number | null;
}

export function americanToDecimal(american: number): number {
  return american > 0 ? 1 + american / 100 : 1 + 100 / -american;
}

export function impliedProb(american: number): number {
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

export function probToAmerican(p: number): number {
  const c = Math.min(0.999, Math.max(0.001, p));
  return c >= 0.5 ? -Math.round((100 * c) / (1 - c)) : Math.round((100 * (1 - c)) / c);
}

export function priceProp(model: FrozenModel, mean: number, quote: Pick<PropLineQuote, "market" | "line" | "overAmerican" | "underAmerican">): PricedProp {
  const pOver = model.pOver(quote.market, mean, quote.line);
  const pUnder = 1 - pOver;
  const { overAmerican: o, underAmerican: u } = quote;
  const marketPOver = o !== null && u !== null ? impliedProb(o) / (impliedProb(o) + impliedProb(u)) : null;
  return {
    pOver,
    pUnder,
    fairOverAmerican: probToAmerican(pOver),
    fairUnderAmerican: probToAmerican(pUnder),
    marketPOver,
    evOver: o === null ? null : pOver * americanToDecimal(o) - 1,
    evUnder: u === null ? null : pUnder * americanToDecimal(u) - 1,
  };
}

/** Name key for matching a book's player label to an nflverse name: case, punctuation, and suffixes (Jr., III) stripped. */
export function playerNameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
