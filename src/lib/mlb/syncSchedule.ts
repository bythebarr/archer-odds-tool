import { prisma } from "@/lib/prisma";
import { etDateOf, etDayBoundsUtc } from "@/lib/dateEt";
import { fetchMlbTeams, fetchMlbSchedule, mapDetailedStateToStatus } from "./statsApi";

/**
 * 2026 regular-season opening day (ET). Everything before this is spring
 * training / exhibition — see the gameType filter in statsApi.ts. Kept in sync
 * with SEASON_START_ET in props/syncGameLogs.ts.
 */
const REGULAR_SEASON_START_ET = "2026-03-25";

export interface SyncScheduleSummary {
  teamsUpserted: number;
  /** Games the MLB Stats API returned for the window, before the team-match filter below. */
  gamesFetched: number;
  gamesUpserted: number;
}

export interface HealStrandedSummary {
  /** Games found stuck non-final with a past start — the thing this heals. */
  strandedFound: number;
  /** Distinct ET dates re-synced (empty when nothing was stranded). */
  datesResynced: string[];
  gamesUpserted: number;
}

/** Upserts MLB teams and the schedule/results for every date in [startDate, endDate] (YYYY-MM-DD). */
export async function syncMlbSchedule(startDate: string, endDate: string): Promise<SyncScheduleSummary> {
  const teams = await fetchMlbTeams();

  for (const team of teams) {
    await prisma.team.upsert({
      where: { mlbTeamId: team.id },
      create: {
        mlbTeamId: team.id,
        name: team.name,
        abbreviation: team.abbreviation,
        league: team.league.name,
        division: team.division.name,
      },
      update: {
        name: team.name,
        abbreviation: team.abbreviation,
        league: team.league.name,
        division: team.division.name,
      },
    });
  }

  const games = await fetchMlbSchedule(startDate, endDate);
  const teamRows = await prisma.team.findMany();
  const teamIdByMlbId = new Map(teamRows.map((t) => [t.mlbTeamId, t.id]));

  let gamesUpserted = 0;
  for (const game of games) {
    const homeTeamId = teamIdByMlbId.get(game.homeTeamId);
    const awayTeamId = teamIdByMlbId.get(game.awayTeamId);
    if (!homeTeamId || !awayTeamId) continue; // e.g. spring training / all-star exhibitions vs non-MLB teams

    await prisma.game.upsert({
      where: { mlbGameId: game.mlbGameId },
      create: {
        mlbGameId: game.mlbGameId,
        season: game.season,
        scheduledStartUtc: game.scheduledStartUtc,
        status: mapDetailedStateToStatus(game.detailedState),
        homeTeamId,
        awayTeamId,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
      },
      update: {
        scheduledStartUtc: game.scheduledStartUtc,
        status: mapDetailedStateToStatus(game.detailedState),
        homeScore: game.homeScore,
        awayScore: game.awayScore,
      },
    });
    gamesUpserted++;
  }

  return { teamsUpserted: teams.length, gamesFetched: games.length, gamesUpserted };
}

/**
 * Backstop healer for games stuck in a non-terminal status (scheduled/live)
 * whose start is already well in the past — a result that never got written
 * back. The fixed-window healers (sync-results' RESULTS_LOOKBACK_DAYS,
 * sync-schedule's HEAL_LOOKBACK_DAYS) stop re-checking a date once it ages out
 * of their window, so if a whole slate's results-write is ever missed, those
 * games freeze at 0-0 forever — and a non-final game is silently dropped from
 * every status=final query (team form's last-5/last-10, hit rates), sliding
 * those windows onto older games and corrupting Archer EV (this is exactly how
 * an entire day's slate stayed wrong in prod). Unlike those healers this one is
 * unbounded by any fixed lookback: it finds the stranded games directly and
 * re-syncs the span of ET dates they fall on. Normally finds nothing (one cheap
 * indexed query) and no-ops.
 */
export async function healStrandedGames(now: Date): Promise<HealStrandedSummary> {
  // 6h grace so a game genuinely still in progress isn't mistaken for stranded.
  const cutoff = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const stranded = await prisma.game.findMany({
    where: {
      sport: "mlb",
      status: { in: ["scheduled", "live"] },
      scheduledStartUtc: { lt: cutoff },
    },
    select: { scheduledStartUtc: true },
  });

  if (stranded.length === 0) return { strandedFound: 0, datesResynced: [], gamesUpserted: 0 };

  const dates = [...new Set(stranded.map((g) => etDateOf(g.scheduledStartUtc)))].sort();
  // Re-sync the contiguous span covering every stranded date in one call
  // (idempotent; almost always a single date, so the span is tight).
  const summary = await syncMlbSchedule(dates[0], dates[dates.length - 1]);

  return { strandedFound: stranded.length, datesResynced: dates, gamesUpserted: summary.gamesUpserted };
}

export interface PurgePreseasonSummary {
  gamesPurged: number;
  logsPurged: number;
}

/**
 * One-time (idempotent) cleanup of spring-training / exhibition MLB games that
 * were ingested as regular-season finals before fetchMlbSchedule got its
 * gameType filter (see statsApi.ts). Those games inflated season records and
 * the runs feeding Archer EV, and their player logs polluted prop hit-rates.
 * The gameType filter stops new ones, but already-stored rows never self-heal
 * (sync only upserts), so this deletes them — child rows first (every FK to
 * Game is RESTRICT). Runs each sync-schedule cycle and no-ops once clean (and
 * stays a no-op: nothing dated before opening day can be ingested again).
 */
export async function purgePreseasonGames(): Promise<PurgePreseasonSummary> {
  const cutoff = etDayBoundsUtc(REGULAR_SEASON_START_ET).gte;
  const preseason = await prisma.game.findMany({
    where: { sport: "mlb", scheduledStartUtc: { lt: cutoff } },
    select: { id: true },
  });
  if (preseason.length === 0) return { gamesPurged: 0, logsPurged: 0 };

  const ids = preseason.map((g) => g.id);
  const where = { gameId: { in: ids } };
  // Delete every child of these games before the games themselves (all FKs to
  // Game are ON DELETE RESTRICT), atomically.
  const results = await prisma.$transaction([
    prisma.playerGameLog.deleteMany({ where }),
    prisma.lineupSlot.deleteMany({ where }),
    prisma.oddsSnapshot.deleteMany({ where }),
    prisma.currentOddsLine.deleteMany({ where }),
    prisma.playerPropSnapshot.deleteMany({ where }),
    prisma.currentPlayerPropLine.deleteMany({ where }),
    prisma.gameClosingLine.deleteMany({ where }),
    prisma.gameOutcome.deleteMany({ where }),
    prisma.game.deleteMany({ where: { id: { in: ids } } }),
  ]);

  return { gamesPurged: preseason.length, logsPurged: results[0].count };
}
