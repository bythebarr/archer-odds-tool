import { americanToDecimal } from "@/lib/odds/americanOdds";

/**
 * Pure play grading — settles a single posted selection against a final result.
 * Mirrors the margin/total conventions in src/lib/grading/gradeOutcomes.ts, but
 * grades at the PLAY'S OWN point (what we posted) rather than the closing line,
 * and returns "void" for anything we can't settle correctly (soccer/tennis game
 * lines have no stored score; a prop with a missing stat line is a DNP, never a
 * loss). Void plays are excluded from the record — better silent than wrong.
 *
 * Settlement differs from tallyPropHits (src/lib/props/hitRate.ts) on one point:
 * that helper is for *projected* hit-rates and treats an exact landing as a miss;
 * a real bet on a whole-number line that lands exactly is a PUSH (stake back),
 * so gradeProp/gradeGameLine return "push" on equality.
 */
export type PlayResult = "hit" | "miss" | "push" | "void";

/** Grade an MLB game-line side (h2h/spreads/totals) against the final score. */
export function gradeGameLine(
  market: "h2h" | "spreads" | "totals",
  side: string,
  point: number | null,
  homeScore: number,
  awayScore: number
): PlayResult {
  if (market === "h2h") {
    if (side !== "home" && side !== "away") return "void"; // MLB has no draw
    const homeWon = homeScore > awayScore; // no push in baseball
    const backedWon = side === "home" ? homeWon : !homeWon;
    return backedWon ? "hit" : "miss";
  }

  if (market === "spreads") {
    if (point === null || (side !== "home" && side !== "away")) return "void";
    const margin =
      side === "home" ? homeScore - awayScore + point : awayScore - homeScore + point;
    return margin > 0 ? "hit" : margin < 0 ? "miss" : "push";
  }

  // totals
  if (point === null) return "void";
  const total = homeScore + awayScore;
  if (side === "over") return total > point ? "hit" : total < point ? "miss" : "push";
  if (side === "under") return total < point ? "hit" : total > point ? "miss" : "push";
  return "void";
}

/**
 * Grade a UFC moneyline pick (a red/blue corner) against the bout's winner.
 * A completed bout with no winnerFighterId is a draw or no-contest — the
 * moneyline is voided at the book (stake back), so that's a "push" here, never
 * a loss. Mirrors gradeGameLine's h2h shape but keyed on corner → fighter id
 * rather than home/away → score.
 */
export function gradeUfcMoneyline(
  side: string,
  redFighterId: string,
  blueFighterId: string,
  winnerFighterId: string | null
): PlayResult {
  if (side !== "red" && side !== "blue") return "void";
  if (winnerFighterId === null) return "push"; // draw / no-contest — ML voided, stake returned
  const pickedFighterId = side === "red" ? redFighterId : blueFighterId;
  return winnerFighterId === pickedFighterId ? "hit" : "miss";
}

/** Grade an MLB player prop (over/under a stat) against the actual stat value. */
export function gradeProp(side: string, point: number, actualValue: number | null): PlayResult {
  if (actualValue === null) return "void"; // DNP / stat not recorded — not a loss
  if (side === "over") return actualValue > point ? "hit" : actualValue < point ? "miss" : "push";
  if (side === "under") return actualValue < point ? "hit" : actualValue > point ? "miss" : "push";
  return "void";
}

/** Profit in units from settling a play at its stake and price. Push/void = 0. */
export function unitsProfit(result: PlayResult, stakeUnits: number, americanPrice: number): number {
  if (result === "hit") return stakeUnits * (americanToDecimal(americanPrice) - 1);
  if (result === "miss") return -stakeUnits;
  return 0; // push or void — stake returned / never risked
}

export interface Ledger {
  hits: number;
  misses: number;
  pushes: number;
  voids: number;
  /** Net profit in units across settled plays (push/void contribute 0). */
  netUnits: number;
  /** "W-L" or "W-L-P" over settled (non-void) plays. */
  record: string;
}

/** Aggregate a set of graded plays into a W-L-P record + net-unit ledger. */
export function tallyLedger(
  plays: { result: PlayResult; units: number; bestPrice: number }[]
): Ledger {
  let hits = 0,
    misses = 0,
    pushes = 0,
    voids = 0,
    netUnits = 0;
  for (const p of plays) {
    if (p.result === "hit") hits++;
    else if (p.result === "miss") misses++;
    else if (p.result === "push") pushes++;
    else {
      voids++;
      continue; // voids don't touch the record or the ledger
    }
    netUnits += unitsProfit(p.result, p.units, p.bestPrice);
  }
  const record = pushes > 0 ? `${hits}-${misses}-${pushes}` : `${hits}-${misses}`;
  return { hits, misses, pushes, voids, netUnits, record };
}
