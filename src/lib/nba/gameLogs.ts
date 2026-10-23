/**
 * NBA player game logs — the history every NBA prop hit rate is computed from.
 *
 * For each completed game on ESPN's scoreboard: find our Game row (the same
 * team-name + ET-date match results.ts uses), or create it when the odds feed
 * never listed the game — backfilled history and games played before NBA polling
 * began still need logs. Then pull the box score once and store a row per player
 * who played. Idempotent: a game that already has logs is skipped, and every
 * write is an upsert.
 */
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { fetchEspnScoreboard, type EspnTeamResult } from "@/lib/teamLeague/espnScoreboard";
import { findGameForResult } from "@/lib/teamLeague/results";
import type { LeagueTeamInfo } from "@/lib/teamLeague/league";
import { NBA_LEAGUE } from "./league";
import { fetchNbaBoxScore, type EspnNbaPlayerLine } from "./espnBoxScore";
import { positionGroup } from "./positions";

export interface SyncNbaGameLogsSummary {
  datesChecked: string[];
  completedGames: number;
  gamesLogged: number;
  /** Games created from ESPN because the odds feed never listed them. */
  gamesCreated: number;
  playerLines: number;
  /** Games whose box score couldn't be fetched or used, with the reason. */
  failures: string[];
}

/**
 * The Team row for an allowlisted team. Matched on the canonical name the odds
 * ingest also stores, so a team first seen here and later seen in the odds feed
 * is one row, not two.
 */
async function teamIdFor(team: LeagueTeamInfo): Promise<string> {
  const existing = await prisma.team.findFirst({ where: { name: team.name }, select: { id: true } });
  if (existing) return existing.id;
  const created = await prisma.team.create({
    data: {
      name: team.name,
      oddsApiName: team.name,
      abbreviation: team.abbreviation,
      league: team.conference,
      division: team.division,
    },
  });
  return created.id;
}

/** A final Game row built from an ESPN result, for a game the odds feed never listed. */
async function createGameFromResult(result: EspnTeamResult) {
  const home = NBA_LEAGUE.lookupTeam(result.homeName);
  const away = NBA_LEAGUE.lookupTeam(result.awayName);
  if (!home || !away) return null; // an exhibition opponent — not an NBA game
  const [homeTeamId, awayTeamId] = await Promise.all([teamIdFor(home), teamIdFor(away)]);
  return prisma.game.create({
    data: {
      sport: "nba",
      season: NBA_LEAGUE.seasonOf(result.startUtc),
      scheduledStartUtc: result.startUtc,
      status: "final",
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      homeTeamId,
      awayTeamId,
    },
  });
}

async function storeLines(
  game: { id: string; scheduledStartUtc: Date; season: number; homeTeamId: string | null; awayTeamId: string | null },
  homeName: string,
  lines: EspnNbaPlayerLine[]
): Promise<number> {
  const homeTeam = NBA_LEAGUE.lookupTeam(homeName);
  let stored = 0;
  for (const line of lines) {
    const team = NBA_LEAGUE.lookupTeam(line.teamName);
    if (!team) continue;
    const isHome = team.name === homeTeam?.name;
    const teamId = isHome ? game.homeTeamId : game.awayTeamId;
    if (!teamId) continue;

    const group = positionGroup(line.position);
    const position = group ? { position: line.position, positionGroup: group } : {};
    const player = await prisma.nbaPlayer.upsert({
      where: { espnAthleteId: line.espnAthleteId },
      create: { espnAthleteId: line.espnAthleteId, fullName: line.name, headshotUrl: line.headshotUrl, teamId, ...position },
      update: { fullName: line.name, headshotUrl: line.headshotUrl ?? undefined, teamId, ...position },
    });

    const stats = {
      gameDate: game.scheduledStartUtc,
      season: game.season,
      teamId,
      isHome,
      starter: line.starter,
      // This game's listing first; else what the player already has on file.
      positionGroup: group ?? player.positionGroup,
      minutes: line.minutes,
      points: line.points,
      rebounds: line.rebounds,
      assists: line.assists,
      threesMade: line.threesMade,
      steals: line.steals,
      blocks: line.blocks,
      turnovers: line.turnovers,
    };
    await prisma.nbaPlayerGameLog.upsert({
      where: { nbaPlayerId_gameId: { nbaPlayerId: player.id, gameId: game.id } },
      create: { gameId: game.id, nbaPlayerId: player.id, ...stats },
      update: stats,
    });
    stored++;
  }
  return stored;
}

/** Logs every completed NBA game on the given ET dates. */
export async function syncNbaGameLogs(datesEt: string[]): Promise<SyncNbaGameLogsSummary> {
  const summary: SyncNbaGameLogsSummary = {
    datesChecked: datesEt,
    completedGames: 0,
    gamesLogged: 0,
    gamesCreated: 0,
    playerLines: 0,
    failures: [],
  };

  for (const dateEt of datesEt) {
    const results = await fetchEspnScoreboard(NBA_LEAGUE.espnPath, dateEt);
    for (const result of results) {
      if (!result.completed || !result.espnEventId) continue;
      summary.completedGames++;
      const label = `${result.awayName} @ ${result.homeName} (${etDateOf(result.startUtc)})`;

      let game = await findGameForResult(NBA_LEAGUE, result);
      if (game && (await prisma.nbaPlayerGameLog.count({ where: { gameId: game.id } })) > 0) continue;
      if (!game) {
        game = await createGameFromResult(result);
        if (!game) continue;
        summary.gamesCreated++;
      }

      try {
        const box = await fetchNbaBoxScore(result.espnEventId);
        if (box.rejectedTeams.length) {
          summary.failures.push(`${label}: unreadable box score for ${box.rejectedTeams.join(", ")}`);
        }
        if (box.lines.length === 0) {
          summary.failures.push(`${label}: no player lines`);
          continue;
        }
        summary.playerLines += await storeLines(game, result.homeName, box.lines);
        summary.gamesLogged++;
      } catch (error) {
        // One game's box score failing shouldn't cost the rest of the slate.
        summary.failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return summary;
}
