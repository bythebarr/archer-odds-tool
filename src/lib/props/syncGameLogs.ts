import { prisma } from "@/lib/prisma";
import { syncMlbSchedule } from "@/lib/mlb/syncSchedule";
import { todayEt } from "@/lib/dateEt";
import { ingestGameLogsForGame } from "./gameLogIngest";

/**
 * Covers late East-Coast finishes/doubleheaders that can cross a UTC
 * calendar-day boundary — sync-results only re-checks "today" (UTC), so a
 * game that went final just after midnight UTC could otherwise sit at
 * status=final with no logs for up to a day.
 */
const LOOKBACK_DAYS = 3;

/** Local dev backfilled from here (see scripts/backfill-player-game-logs.ts) — production's one-time historical backfill uses the same start. */
const SEASON_START_ET = "2026-03-01";

export interface SyncGameLogsSummary {
  gamesIngested: number;
  rowsWritten: number;
  gamesFailed: number;
}

interface GameForIngest {
  id: string;
  mlbGameId: number | null;
  scheduledStartUtc: Date;
  homeTeamId: string | null;
  awayTeamId: string | null;
}

async function ingestGames(games: GameForIngest[]): Promise<SyncGameLogsSummary> {
  let rowsWritten = 0;
  let gamesFailed = 0;

  for (const game of games) {
    if (!game.mlbGameId || !game.homeTeamId || !game.awayTeamId) continue;
    try {
      rowsWritten += await ingestGameLogsForGame({
        id: game.id,
        mlbGameId: game.mlbGameId,
        scheduledStartUtc: game.scheduledStartUtc,
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
      });
    } catch (error) {
      gamesFailed++;
      console.error(`syncGameLogs: failed to ingest game ${game.mlbGameId}:`, error);
    }
  }

  return { gamesIngested: games.length - gamesFailed, rowsWritten, gamesFailed };
}

/**
 * Ingests PlayerGameLog rows for any final MLB game in the last
 * LOOKBACK_DAYS that doesn't have any yet — free (MLB Stats API), meant to
 * run alongside sync-results so newly-final games get picked up within one
 * cycle, independent of the (separate, paid) odds-polling cadence.
 */
export async function syncRecentPlayerGameLogs(): Promise<SyncGameLogsSummary> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3_600_000);

  const games = await prisma.game.findMany({
    where: { sport: "mlb", status: "final", scheduledStartUtc: { gte: since }, playerGameLogs: { none: {} } },
    select: { id: true, mlbGameId: true, scheduledStartUtc: true, homeTeamId: true, awayTeamId: true },
  });

  return ingestGames(games);
}

/**
 * One-time (idempotent) historical Team/Game backfill for the full season —
 * the regular sync-schedule cron only ever syncs a rolling forward window,
 * so production never otherwise gets the season's early games. Cheap to
 * call repeatedly: no-ops once an early-season game is already present.
 */
export async function ensureSeasonScheduleSynced(): Promise<boolean> {
  const earlySeasonGame = await prisma.game.findFirst({
    where: { sport: "mlb", scheduledStartUtc: { lt: new Date("2026-04-01T00:00:00Z") } },
    select: { id: true },
  });
  if (earlySeasonGame) return false;

  await syncMlbSchedule(SEASON_START_ET, todayEt());
  return true;
}

export interface BackfillBatchSummary extends SyncGameLogsSummary {
  /** Final MLB games still missing logs after this batch — 0 means fully caught up. */
  remaining: number;
  scheduleBackfilled: boolean;
}

/**
 * Ingests the next `limit` final MLB games (oldest first) missing
 * PlayerGameLog rows, regardless of age — unlike syncRecentPlayerGameLogs's
 * rolling lookback, this is the one-time full-history catch-up path. Bounded
 * per call (not all ~1,600 games at once) to stay well under a serverless
 * function's execution timeout; call repeatedly until `remaining` hits 0.
 */
export async function backfillMissingPlayerGameLogs(limit: number): Promise<BackfillBatchSummary> {
  const scheduleBackfilled = await ensureSeasonScheduleSynced();

  const games = await prisma.game.findMany({
    where: { sport: "mlb", status: "final", playerGameLogs: { none: {} } },
    select: { id: true, mlbGameId: true, scheduledStartUtc: true, homeTeamId: true, awayTeamId: true },
    orderBy: { scheduledStartUtc: "asc" },
    take: limit,
  });

  const summary = await ingestGames(games);
  const remaining = await prisma.game.count({
    where: { sport: "mlb", status: "final", playerGameLogs: { none: {} } },
  });

  return { ...summary, remaining, scheduleBackfilled };
}
