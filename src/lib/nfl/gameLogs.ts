/**
 * NFL player game logs — the history every NFL prop hit rate and projection is
 * computed from. The NBA pipeline (src/lib/nba/gameLogs.ts) for football: for
 * each completed game on ESPN's scoreboard, find (or create) our Game row by
 * team names + ET day, pull the box score once, and upsert a row per player
 * with a passing, rushing, receiving, kicking or defensive line. Idempotent — a
 * game already logged with its defensive tables is skipped.
 */
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { espnTeamCode } from "@/lib/logos";
import { fetchEspnScoreboard, type EspnTeamResult } from "@/lib/teamLeague/espnScoreboard";
import { findGameForResult, storePeriodScores } from "@/lib/teamLeague/results";
import { teamIdForLeagueTeam } from "@/lib/teamLeague/schedule";
import { parseEspnRoster } from "@/lib/nba/positions";
import { NFL_LEAGUE } from "./league";
import { NFL_TEAMS } from "./teams";
import { fetchNflBoxScore, type EspnNflPlayerLine } from "./espnBoxScore";
import { nflPositionGroup } from "./propStats";

export interface SyncNflGameLogsSummary {
  datesChecked: number;
  completedGames: number;
  gamesLogged: number;
  gamesCreated: number;
  playerLines: number;
  failures: string[];
}

async function createGameFromResult(result: EspnTeamResult) {
  const home = NFL_LEAGUE.lookupTeam(result.homeName);
  const away = NFL_LEAGUE.lookupTeam(result.awayName);
  if (!home || !away) return null;
  const [homeTeamId, awayTeamId] = await Promise.all([teamIdForLeagueTeam(home), teamIdForLeagueTeam(away)]);
  return prisma.game.create({
    data: {
      sport: "nfl",
      season: NFL_LEAGUE.seasonOf(result.startUtc),
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
  lines: EspnNflPlayerLine[]
): Promise<number> {
  const homeTeam = NFL_LEAGUE.lookupTeam(homeName);
  let stored = 0;
  for (const line of lines) {
    const team = NFL_LEAGUE.lookupTeam(line.teamName);
    if (!team) continue;
    const isHome = team.name === homeTeam?.name;
    const teamId = isHome ? game.homeTeamId : game.awayTeamId;
    if (!teamId) continue;

    // A box score that doesn't list positions still tells on a passer.
    const listed = nflPositionGroup(line.position) ? line.position : line.passAttempts >= 5 ? "QB" : null;
    const player = await prisma.nflPlayer.upsert({
      where: { espnAthleteId: line.espnAthleteId },
      create: { espnAthleteId: line.espnAthleteId, fullName: line.name, teamId, position: listed },
      update: { fullName: line.name, teamId, ...(listed ? { position: listed } : {}) },
    });

    const data = {
      gameDate: game.scheduledStartUtc,
      season: game.season,
      teamId,
      isHome,
      position: listed ?? player.position,
      passAttempts: line.passAttempts,
      passCompletions: line.passCompletions,
      passYards: line.passYards,
      passTds: line.passTds,
      interceptions: line.interceptions,
      rushAttempts: line.rushAttempts,
      rushYards: line.rushYards,
      rushTds: line.rushTds,
      receptions: line.receptions,
      targets: line.targets,
      recYards: line.recYards,
      recTds: line.recTds,
      rushLongest: line.rushLongest,
      recLongest: line.recLongest,
      fieldGoalsMade: line.fieldGoalsMade,
      extraPointsMade: line.extraPointsMade,
      kickingPoints: line.kickingPoints,
      tackles: line.tackles,
      soloTackles: line.soloTackles,
      sacks: line.sacks,
    };
    await prisma.nflPlayerGameLog.upsert({
      where: { nflPlayerId_gameId: { nflPlayerId: player.id, gameId: game.id } },
      create: { gameId: game.id, nflPlayerId: player.id, ...data },
      update: data,
    });
    stored++;
  }
  return stored;
}

/** Logs every completed NFL game on the given ET dates. */
export async function syncNflGameLogs(datesEt: string[]): Promise<SyncNflGameLogsSummary> {
  const summary: SyncNflGameLogsSummary = { datesChecked: datesEt.length, completedGames: 0, gamesLogged: 0, gamesCreated: 0, playerLines: 0, failures: [] };
  for (const dateEt of datesEt) {
    const results = await fetchEspnScoreboard(NFL_LEAGUE.espnPath, dateEt);
    for (const result of results) {
      if (!result.completed || !result.espnEventId) continue;
      summary.completedGames++;
      const label = `${result.awayName} @ ${result.homeName} (${etDateOf(result.startUtc)})`;
      let game = await findGameForResult(NFL_LEAGUE, result);
      // Period scores ride along (cheap: the scoreboard is already in hand), so a history backfill fills halves and quarters too.
      if (game) await storePeriodScores(game, result);
      // Logged already — and with the defense/kicking tables (logs from before those
      // were read get one more pass, which fills them in).
      if (game && (await prisma.nflPlayerGameLog.count({ where: { gameId: game.id, tackles: { not: null } } })) > 0) continue;
      if (!game) {
        game = await createGameFromResult(result);
        if (!game) continue;
        summary.gamesCreated++;
      }
      try {
        const box = await fetchNflBoxScore(result.espnEventId);
        if (box.rejected.length) summary.failures.push(`${label}: unreadable ${box.rejected.join(", ")}`);
        if (box.lines.length === 0) {
          summary.failures.push(`${label}: no player lines`);
          continue;
        }
        summary.playerLines += await storeLines(game, result.homeName, box.lines);
        summary.gamesLogged++;
      } catch (error) {
        summary.failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return summary;
}

const ROSTER_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";

/**
 * Fills positions the box scores didn't list, from the 32 rosters, then stamps
 * them onto unstamped logs. Only fetches when an active player is missing one.
 */
export async function syncNflPositions(): Promise<{ missingBefore: number; playersUpdated: number; logsStamped: number; failures: string[] }> {
  const recent = new Date(Date.now() - 45 * 86_400_000);
  const missingBefore = await prisma.nflPlayer.count({ where: { position: null, gameLogs: { some: { gameDate: { gte: recent } } } } });
  let playersUpdated = 0;
  const failures: string[] = [];
  if (missingBefore > 0) {
    for (const team of NFL_TEAMS) {
      try {
        const res = await fetch(`${ROSTER_URL}/${espnTeamCode("nfl", team.abbreviation)}/roster`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        for (const [espnAthleteId, position] of parseEspnRoster(await res.json())) {
          if (!nflPositionGroup(position)) continue;
          const { count } = await prisma.nflPlayer.updateMany({ where: { espnAthleteId, position: null }, data: { position } });
          playersUpdated += count;
        }
      } catch (error) {
        failures.push(`${team.abbreviation}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  const logsStamped = await prisma.$executeRaw`
    UPDATE "NflPlayerGameLog" AS l SET "position" = p."position"
    FROM "NflPlayer" AS p
    WHERE l."nflPlayerId" = p.id AND l."position" IS NULL AND p."position" IS NOT NULL`;
  return { missingBefore, playersUpdated, logsStamped, failures };
}
