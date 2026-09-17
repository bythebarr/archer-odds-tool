import { prisma } from "@/lib/prisma";
import type { MarketType, Side, OutcomeResult, Game } from "@/generated/prisma/client";

/** Most-common (mode) point among a set of snapshots; null if none have a point (e.g. h2h). */
function modePoint(rows: { point: number | null }[]): number | null {
  const counts = new Map<number, number>();
  for (const r of rows) {
    if (r.point === null) continue;
    counts.set(r.point, (counts.get(r.point) ?? 0) + 1);
  }
  let bestPoint: number | null = null;
  let bestCount = -1;
  for (const [point, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestPoint = point;
    }
  }
  return bestPoint;
}

/**
 * Captures the consensus closing line for (game, market, side): the modal
 * point across each book's last snapshot before first pitch, and the average
 * price among books quoting that point. Upserts GameClosingLine and returns it.
 */
async function captureClosingLine(game: Game, marketType: MarketType, side: Side) {
  // isAlternate: false is required, not optional, once alt lines exist — a
  // single poll now writes multiple OddsSnapshot rows per book (one per
  // point) at the same polledAt, and without this filter the per-book
  // "latest" dedup below could arbitrarily grab an alt-line row instead of
  // the main line, corrupting the modePoint() consensus grading depends on.
  const snapshots = await prisma.oddsSnapshot.findMany({
    where: {
      gameId: game.id,
      marketType,
      side,
      polledAt: { lt: game.scheduledStartUtc },
      isAlternate: false,
    },
    orderBy: { polledAt: "desc" },
  });

  const seenBooks = new Set<string>();
  const latestPerBook: typeof snapshots = [];
  for (const s of snapshots) {
    if (seenBooks.has(s.bookKey)) continue;
    seenBooks.add(s.bookKey);
    latestPerBook.push(s);
  }
  if (latestPerBook.length === 0) return null;

  const point = modePoint(latestPerBook);
  const matching = latestPerBook.filter((r) => r.point === point);
  const priceAmerican = Math.round(
    matching.reduce((sum, r) => sum + r.priceAmerican, 0) / matching.length
  );

  return prisma.gameClosingLine.upsert({
    where: { gameId_marketType_side: { gameId: game.id, marketType, side } },
    create: { gameId: game.id, marketType, side, point, priceAmerican, capturedAt: latestPerBook[0].polledAt },
    update: { point, priceAmerican, capturedAt: latestPerBook[0].polledAt },
  });
}

async function upsertOutcome(
  gameId: string,
  teamId: string,
  marketType: MarketType,
  result: OutcomeResult
) {
  await prisma.gameOutcome.upsert({
    where: { gameId_teamId_marketType: { gameId, teamId, marketType } },
    create: { gameId, teamId, marketType, result },
    update: { result },
  });
}

/** Team-pair sports this grades. Tennis grades through its own adapter (player-pair rows). */
const GRADABLE_TEAM_SPORTS = new Set(["mlb", "nfl"]);

/**
 * Grades a single final game across all three v1 markets. Idempotent (safe to
 * re-run). Totals convention: GameOutcome.result for market "totals" always
 * means "did the Over hit" — the hit-rate query flips this for "under" asks.
 *
 * Sport-agnostic across team-pair sports: the spread and total math is just
 * arithmetic on a final score, so NFL reuses it unchanged. The one real
 * difference is the moneyline, which CAN push in the NFL — see below.
 */
/**
 * Returns the number of `GameOutcome` rows written, so a caller can tell "graded"
 * from "considered but produced nothing" — the same distinction
 * `gradeUngradedGames` needs to report truthfully (see its own doc comment and
 * docs/architecture/EDGE-BASELINE-AUDIT.md's Step 2 section). Any existing
 * caller that ignores the return value (NFL's `results.ts`) is unaffected.
 */
export async function gradeGame(game: Game): Promise<number> {
  if (game.homeScore === null || game.awayScore === null) return 0;
  // The DB CHECK constraint guarantees homeTeamId/awayTeamId are non-null for
  // these sports, so the id guards are unreachable in practice rather than just
  // type-narrowing noise.
  if (!GRADABLE_TEAM_SPORTS.has(game.sport) || game.homeTeamId === null || game.awayTeamId === null) return 0;

  let outcomesWritten = 0;

  // Moneyline. Baseball plays until someone wins, but an NFL game CAN end tied
  // (once or twice a season), and a tie pushes the moneyline — bets are
  // refunded, not lost. Grading that as a loss for both sides would quietly
  // understate the record on exactly the games people remember.
  const tie = game.homeScore === game.awayScore;
  const homeWon = game.homeScore > game.awayScore;
  await upsertOutcome(game.id, game.homeTeamId, "h2h", tie ? "push" : homeWon ? "hit" : "miss");
  await upsertOutcome(game.id, game.awayTeamId, "h2h", tie ? "push" : homeWon ? "miss" : "hit");
  outcomesWritten += 2;

  // Spread (run line): grade each side against its own closing point.
  const homeSpread = await captureClosingLine(game, "spreads", "home");
  if (homeSpread?.point != null) {
    const margin = game.homeScore - game.awayScore + homeSpread.point;
    const result: OutcomeResult = margin > 0 ? "hit" : margin < 0 ? "miss" : "push";
    await upsertOutcome(game.id, game.homeTeamId, "spreads", result);
    outcomesWritten++;
  }
  const awaySpread = await captureClosingLine(game, "spreads", "away");
  if (awaySpread?.point != null) {
    const margin = game.awayScore - game.homeScore + awaySpread.point;
    const result: OutcomeResult = margin > 0 ? "hit" : margin < 0 ? "miss" : "push";
    await upsertOutcome(game.id, game.awayTeamId, "spreads", result);
    outcomesWritten++;
  }

  // Total: symmetric for both teams, canonically graded from the Over's perspective.
  const over = await captureClosingLine(game, "totals", "over");
  if (over?.point != null) {
    const actualTotal = game.homeScore + game.awayScore;
    const result: OutcomeResult =
      actualTotal > over.point ? "hit" : actualTotal < over.point ? "miss" : "push";
    await upsertOutcome(game.id, game.homeTeamId, "totals", result);
    await upsertOutcome(game.id, game.awayTeamId, "totals", result);
    outcomesWritten += 2;
  }

  return outcomesWritten;
}

export interface GradeUngradedGamesSummary {
  /** Final MLB games with no outcomes yet, found this run. */
  considered: number;
  /** Of those, how many actually got at least one `GameOutcome` row written. */
  graded: number;
}

/**
 * Grades every final MLB game that doesn't have outcomes recorded yet.
 * `considered` vs `graded` lets a caller tell "nothing was ungraded" (both 0 —
 * a legitimate empty run, e.g. this tick right after the previous one caught
 * everything) from "found ungraded games but wrote no outcomes for any of
 * them" (considered > 0, graded === 0 — a real problem: `gradeGame` only
 * skips a game when its scores are missing or its sport isn't gradable,
 * neither of which should be true for a `status: "final"` MLB row).
 */
export async function gradeUngradedGames(): Promise<GradeUngradedGamesSummary> {
  const ungraded = await prisma.game.findMany({
    where: { sport: "mlb", status: "final", outcomes: { none: {} } },
  });

  let graded = 0;
  for (const game of ungraded) {
    const outcomesWritten = await gradeGame(game);
    if (outcomesWritten > 0) graded++;
  }

  return { considered: ungraded.length, graded };
}
