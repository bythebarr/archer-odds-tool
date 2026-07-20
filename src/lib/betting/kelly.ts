import { americanToDecimal } from "@/lib/odds/americanOdds";

/**
 * Kelly stake sizing, shared by every place that turns an edge into units — the
 * Discord card (postCard.ts) and the sport engine's `Play.suggestedUnits`. Pure
 * and dependency-light on purpose: the engine sizes plays without importing the
 * Discord module. Extracted verbatim from postCard.ts (unchanged math).
 */

/**
 * Quarter Kelly, the fraction of full Kelly we actually stake. Full Kelly is the
 * theoretically optimal stake but famously too swingy for real bankrolls; a
 * quarter keeps the by-edge shape while taming variance.
 */
const KELLY_FRACTION = 0.25;
/**
 * How much bankroll one printed "unit" represents. Kelly outputs a bankroll
 * fraction; dividing by this converts it to units. 2% (rather than the textbook
 * 1%) is a labeling choice that lands typical plays in a clean 0.25–3u range.
 */
const UNIT_BANKROLL = 0.02;
/** Never smaller than a token play — nothing reads reckless, tiny edges still show. */
const MIN_UNITS = 0.25;

/**
 * Per-price stake ceiling — the longer the odds, the smaller the biggest bet we
 * allow, NO MATTER how juicy the edge. Long-priced "monster edges" are exactly
 * where the model is least trustworthy, so we refuse to fire fat numbers at them:
 * favorites & short dogs (≤ +150) can run the full 3u, but +200+ is clamped hard.
 * These four numbers are pure product preference — tune to taste.
 */
function maxUnitsForPrice(americanPrice: number): number {
  if (americanPrice <= 150) return 3; // negatives through +150 — heavy allowed
  if (americanPrice <= 175) return 1.5;
  if (americanPrice <= 350) return 0.75;
  return 0.5;
}

/**
 * Stake in units, sized by the **Kelly Criterion** then capped by price. Kelly
 * stakes `edge / (decimalOdds − 1)`: a big model edge sizes up hard, a thin one
 * barely registers, and for the SAME edge a favorite is staked bigger than a dog
 * (the win is likelier) — the "he's plus but our model has him minus = big one"
 * instinct. On top of that, maxUnitsForPrice hard-ceilings long-priced plays so a
 * +200 dog never gets a fat stake even on a huge (likely miscalibrated) edge.
 * Quarter Kelly, floored at 0.25u, rounded to a clean 0.25u. (units-not-dollars.)
 */
export function unitsFor(ev: number, americanPrice: number): number {
  if (ev <= 0) return MIN_UNITS; // not an edge — never size a non-play up
  const b = americanToDecimal(americanPrice) - 1; // net decimal odds
  const kellyUnits = (KELLY_FRACTION * (ev / b)) / UNIT_BANKROLL;
  const units = Math.min(kellyUnits, maxUnitsForPrice(americanPrice));
  return Math.round(Math.max(MIN_UNITS, units) * 4) / 4; // nearest 0.25u
}
