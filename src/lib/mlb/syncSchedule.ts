import { prisma } from "@/lib/prisma";
import { fetchMlbTeams, fetchMlbSchedule, mapDetailedStateToStatus } from "./statsApi";

export interface SyncScheduleSummary {
  teamsUpserted: number;
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
