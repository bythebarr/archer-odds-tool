import { prisma } from "@/lib/prisma";
import { fetchScores, type OddsApiScoreEntry, type OddsApiScoreResult } from "@/lib/odds/oddsApiClient";
import { resolveActiveTennisSportKey } from "./ingest";

/** /scores' daysFrom param max — see fetchScores. */
const DAYS_FROM = 3;

/**
 * Parses a completed match's winning side from The Odds API's /scores
 * response. ASSUMPTION, unverified against a real completed match as of
 * this writing (Wimbledon had zero completed matches in either sport during
 * implementation — every live test this session returned `completed: false`
 * for every event): `score` is each competitor's final sets-won count, as a
 * plain integer string — The Odds API's documented "final score" convention
 * applied to a set-based sport. Spot-check this against a real result once
 * one exists.
 *
 * Deliberately strict: `Number(...)` (not `parseInt`) rejects anything that
 * isn't a clean integer string outright, rather than silently misparsing a
 * differently-shaped value (e.g. a full "6-4 6-3" set-by-set string would
 * parse as NaN here, not as 6). Returns null — skip grading, don't guess —
 * for any shape mismatch. A match sitting ungraded one more cycle is
 * recoverable; a wrongly graded one corrupts hit-rate history permanently.
 */
export function parseWinningSide(
  scores: OddsApiScoreEntry[] | null,
  homeName: string,
  awayName: string
): "home" | "away" | null {
  if (!scores || scores.length !== 2) return null;

  const home = scores.find((s) => s.name === homeName);
  const away = scores.find((s) => s.name === awayName);
  if (!home || !away) return null;

  const homeSets = Number(home.score);
  const awaySets = Number(away.score);
  if (!Number.isInteger(homeSets) || !Number.isInteger(awaySets) || homeSets === awaySets) return null;

  return homeSets > awaySets ? "home" : "away";
}

async function upsertPlayerH2hOutcome(gameId: string, playerId: string, result: "hit" | "miss") {
  await prisma.gameOutcome.upsert({
    where: { gameId_playerId_marketType: { gameId, playerId, marketType: "h2h" } },
    create: { gameId, playerId, marketType: "h2h", result },
    update: { result },
  });
}

export interface SyncTennisResultsSummary {
  sportKeyChecked: string | null;
  resultsFetched: number;
  matchesGraded: number;
  matchesSkippedUnparseable: number;
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

/**
 * Checks the currently-active allowlisted tournament for completed results
 * and grades any newly-final tennis matches — h2h (moneyline) only, v1's
 * only tennis market. Unlike MLB's split sync-results/grade-outcomes jobs
 * (schedule completion and grading come from two separate free MLB Stats
 * API calls), tennis combines both into one /scores call, since that's the
 * only source of either signal here.
 */
export async function syncAndGradeTennisResults(): Promise<SyncTennisResultsSummary> {
  const sportKey = await resolveActiveTennisSportKey();
  if (!sportKey) {
    return {
      sportKeyChecked: null,
      resultsFetched: 0,
      matchesGraded: 0,
      matchesSkippedUnparseable: 0,
      creditsUsed: null,
      creditsRemaining: null,
    };
  }

  const { results, creditsUsed, creditsRemaining } = await fetchScores(sportKey, DAYS_FROM);
  const completed = results.filter((r: OddsApiScoreResult) => r.completed);

  let matchesGraded = 0;
  let matchesSkippedUnparseable = 0;

  for (const result of completed) {
    const match = await prisma.game.findUnique({
      where: { oddsApiEventId: result.id, sport: "tennis" },
      include: { homePlayer: true, awayPlayer: true },
    });
    // Not one of ours (different allowlisted key historically, or not yet
    // polled) — nothing to grade.
    if (!match || !match.homePlayerId || !match.awayPlayerId) continue;

    const winner = parseWinningSide(result.scores, result.home_team, result.away_team);
    if (!winner) {
      matchesSkippedUnparseable++;
      continue;
    }

    await upsertPlayerH2hOutcome(match.id, match.homePlayerId, winner === "home" ? "hit" : "miss");
    await upsertPlayerH2hOutcome(match.id, match.awayPlayerId, winner === "away" ? "hit" : "miss");

    if (match.status !== "final") {
      await prisma.game.update({ where: { id: match.id }, data: { status: "final" } });
    }
    matchesGraded++;
  }

  return {
    sportKeyChecked: sportKey,
    resultsFetched: results.length,
    matchesGraded,
    matchesSkippedUnparseable,
    creditsUsed,
    creditsRemaining,
  };
}
