import type { GameLineRow } from "@/lib/queries/games";
import type { TeamHitRates } from "@/lib/queries/hitRate";
import type { MarketType } from "@/generated/prisma/client";
import {
  consensusFairProbability,
  calculateEv,
  type ConsensusFairProbability,
  type DevigPair,
} from "./devig";

/** The two sides paired together for devig purposes, per market. */
const SIDE_A: Record<MarketType, string> = { h2h: "home", spreads: "home", totals: "over" };
const SIDE_B: Record<MarketType, string> = { h2h: "away", spreads: "away", totals: "under" };

function buildPairs(lines: GameLineRow[], marketType: MarketType): DevigPair[] {
  const sideA = SIDE_A[marketType];
  const sideB = SIDE_B[marketType];
  const aByBook = new Map(lines.filter((l) => l.side === sideA).map((l) => [l.bookKey, l]));
  const bByBook = new Map(lines.filter((l) => l.side === sideB).map((l) => [l.bookKey, l]));

  const pairs: DevigPair[] = [];
  for (const [bookKey, a] of aByBook) {
    const b = bByBook.get(bookKey);
    if (!b) continue; // book only quoting one side of the market isn't usable for devig
    pairs.push({ bookKey, priceA: a.priceAmerican, priceB: b.priceAmerican, point: a.point });
  }
  return pairs;
}

export interface RowEconomics {
  marketFairProb: number | null;
  marketEv: number | null;
  historicalFairProb: number | null;
  historicalEv: number | null;
}

export interface EconomicsContext {
  marketType: MarketType;
  lines: GameLineRow[]; // all current lines for this market (both sides), same shape as buildPairs expects
  historicalProbBySide: Partial<Record<string, number | null>>;
}

export function lineKey(bookKey: string, side: string, point: number | null): string {
  return `${bookKey}-${side}-${point}`;
}

/**
 * De-vigged market consensus win probability for a game's moneyline market
 * (fairProbA = home, fairProbB = away), reusable outside computeLineEconomics
 * — e.g. to compare against the Archer model's own win probability.
 */
export function h2hMarketConsensus(lines: GameLineRow[]): ConsensusFairProbability {
  return consensusFairProbability(buildPairs(lines.filter((l) => l.marketType === "h2h"), "h2h"));
}

/**
 * Computes, per line row in one point-group, EV against two fair-probability
 * estimates: the de-vigged market consensus, and the team/side's historical
 * hit rate. Market EV is only computed for rows quoting the modal point
 * within this group (see devig.ts) — a book on an off-market point isn't the
 * same bet, so there's nothing correct to compare it against.
 */
function computeEconomicsForGroup(
  lines: GameLineRow[],
  marketType: MarketType,
  historicalProbBySide: Partial<Record<string, number | null>>
): Map<string, RowEconomics> {
  const sideA = SIDE_A[marketType];
  const sideB = SIDE_B[marketType];
  const consensus = consensusFairProbability(buildPairs(lines, marketType));

  const result = new Map<string, RowEconomics>();
  for (const line of lines) {
    const matchesModalPoint = line.point === consensus.modalPoint;
    let marketFairProb: number | null = null;
    if (matchesModalPoint) {
      if (line.side === sideA) marketFairProb = consensus.fairProbA;
      else if (line.side === sideB) marketFairProb = consensus.fairProbB;
    }

    const historicalFairProb = historicalProbBySide[line.side] ?? null;

    result.set(lineKey(line.bookKey, line.side, line.point), {
      marketFairProb,
      marketEv: marketFairProb !== null ? calculateEv(marketFairProb, line.priceAmerican) : null,
      historicalFairProb,
      historicalEv:
        historicalFairProb !== null ? calculateEv(historicalFairProb, line.priceAmerican) : null,
    });
  }
  return result;
}

/**
 * Computes EV for every line, main and alt alike. Main-line rows (isAlternate
 * false) get one consensus across the whole side, exactly as before alt
 * lines existed. Alt-line rows can't share that consensus — a -1.5 price
 * isn't the same bet as a -2.5 price — so they're grouped by their own point
 * and each point gets its own independent consensus/EV, reusing the same
 * pairing+devig math per group.
 */
export function computeLineEconomics({
  marketType,
  lines,
  historicalProbBySide,
}: EconomicsContext): Map<string, RowEconomics> {
  const mainLines = lines.filter((l) => !l.isAlternate);
  const altLines = lines.filter((l) => l.isAlternate);

  const result = computeEconomicsForGroup(mainLines, marketType, historicalProbBySide);

  const altByPoint = new Map<number | null, GameLineRow[]>();
  for (const line of altLines) {
    const group = altByPoint.get(line.point) ?? [];
    group.push(line);
    altByPoint.set(line.point, group);
  }
  for (const group of altByPoint.values()) {
    for (const [key, econ] of computeEconomicsForGroup(group, marketType, historicalProbBySide)) {
      result.set(key, econ);
    }
  }

  return result;
}

function avgOrNull(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return (a + b) / 2;
}

/** Historical hit-rate, expressed as a probability per side, for the given market. */
export function historicalProbBySide(
  market: MarketType,
  homeHitRates: TeamHitRates,
  awayHitRates: TeamHitRates
): Partial<Record<string, number | null>> {
  if (market === "h2h") return { home: homeHitRates.h2h.hitRate, away: awayHitRates.h2h.hitRate };
  if (market === "spreads") {
    return { home: homeHitRates.spreads.hitRate, away: awayHitRates.spreads.hitRate };
  }
  return {
    over: avgOrNull(homeHitRates.totalsOver.hitRate, awayHitRates.totalsOver.hitRate),
    under: avgOrNull(homeHitRates.totalsUnder.hitRate, awayHitRates.totalsUnder.hitRate),
  };
}
