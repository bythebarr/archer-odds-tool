import type { GameLineRow } from "@/lib/queries/games";
import type { MarketType } from "@/generated/prisma/client";
import { consensusFairProbability, calculateEv, type DevigPair } from "./devig";

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
 * Computes, per line row, EV against two fair-probability estimates: the
 * de-vigged market consensus, and the team/side's historical hit rate. Market
 * EV is only computed for rows quoting the modal point (see devig.ts) — a
 * book on an off-market point isn't the same bet, so there's nothing correct
 * to compare it against.
 */
export function computeLineEconomics({
  marketType,
  lines,
  historicalProbBySide,
}: EconomicsContext): Map<string, RowEconomics> {
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
