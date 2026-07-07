import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { fetchMlbTeams, fetchMlbSchedule, mapDetailedStateToStatus } from "./statsApi";

export interface SyncScheduleSummary {
  teamsUpserted: number;
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

  return { teamsUpserted: teams.length, gamesUpserted };
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
