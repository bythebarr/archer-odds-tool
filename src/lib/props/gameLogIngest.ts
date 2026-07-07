import { prisma } from "@/lib/prisma";
import {
  fetchMlbBoxscore,
  fetchMlbPersonHandedness,
  type MlbBoxscore,
  type MlbBoxscorePlayer,
  type MlbBoxscoreTeam,
} from "@/lib/mlb/statsApi";
import type { Handedness } from "@/generated/prisma/client";

interface GameForIngest {
  id: string;
  mlbGameId: number;
  scheduledStartUtc: Date;
  homeTeamId: string;
  awayTeamId: string;
}

/**
 * Upserts an MlbPlayer row for every player in the boxscore, fetching
 * handedness only for personIds we haven't seen before — the batch endpoint
 * covers a whole game's ~40-50 players (both teams) in one call, and repeat
 * games mostly hit players already in the table (no-op after the first time
 * a given player is seen anywhere in the backfill).
 */
async function upsertPlayersAndGetIdMap(boxscore: MlbBoxscore): Promise<Map<number, string>> {
  const allPlayers = [...boxscore.home.players, ...boxscore.away.players];
  const personIds = allPlayers.map((p) => p.personId);

  const existing = await prisma.mlbPlayer.findMany({
    where: { mlbPersonId: { in: personIds } },
    select: { mlbPersonId: true },
  });
  const existingIds = new Set(existing.map((p) => p.mlbPersonId));
  const newPersonIds = personIds.filter((id) => !existingIds.has(id));
  const handedness = await fetchMlbPersonHandedness(newPersonIds);

  const idMap = new Map<number, string>();
  for (const player of allPlayers) {
    const hand = handedness.get(player.personId);
    const row = await prisma.mlbPlayer.upsert({
      where: { mlbPersonId: player.personId },
      create: {
        mlbPersonId: player.personId,
        fullName: player.fullName,
        batSide: (hand?.batSide as Handedness | undefined) ?? null,
        pitchHand: (hand?.pitchHand as Handedness | undefined) ?? null,
      },
      update: {},
    });
    idMap.set(player.personId, row.id);
  }
  return idMap;
}

function findStarterPersonId(team: MlbBoxscoreTeam): number | null {
  const starter = team.players.find((p) => p.pitching && p.pitching.gamesStarted === 1);
  return starter?.personId ?? null;
}

/**
 * Ingests one final MLB game's boxscore into PlayerGameLog — one row per
 * player who batted and/or pitched, with the opposing team's starter (and
 * their throwing hand) attached for the vs-LHP/RHP split. Idempotent: safe
 * to re-run for a game already ingested (e.g. a corrected late box score).
 */
export async function ingestGameLogsForGame(game: GameForIngest): Promise<number> {
  const boxscore = await fetchMlbBoxscore(game.mlbGameId);
  const idMap = await upsertPlayersAndGetIdMap(boxscore);

  const homeStarterPersonId = findStarterPersonId(boxscore.home);
  const awayStarterPersonId = findStarterPersonId(boxscore.away);
  const homeStarterId = homeStarterPersonId !== null ? (idMap.get(homeStarterPersonId) ?? null) : null;
  const awayStarterId = awayStarterPersonId !== null ? (idMap.get(awayStarterPersonId) ?? null) : null;

  let written = 0;

  async function ingestTeam(
    team: MlbBoxscoreTeam,
    teamId: string,
    isHome: boolean,
    opposingStarterId: string | null
  ) {
    const opposingStarterHand = opposingStarterId ? await handednessFor(idMap, opposingStarterId) : null;

    for (const player of team.players) {
      if (!player.batting && !player.pitching) continue;
      const mlbPlayerId = idMap.get(player.personId);
      if (!mlbPlayerId) continue;

      await prisma.playerGameLog.upsert({
        where: { mlbPlayerId_gameId: { mlbPlayerId, gameId: game.id } },
        create: {
          gameId: game.id,
          gameDate: game.scheduledStartUtc,
          mlbPlayerId,
          teamId,
          isHome,
          opposingStarterId,
          opposingStarterHand,
          ...battingFields(player),
          ...pitchingFields(player),
        },
        update: {
          ...battingFields(player),
          ...pitchingFields(player),
        },
      });
      written++;
    }
  }

  await ingestTeam(boxscore.home, game.homeTeamId, true, awayStarterId);
  await ingestTeam(boxscore.away, game.awayTeamId, false, homeStarterId);

  return written;
}

async function handednessFor(idMap: Map<number, string>, mlbPlayerId: string | null): Promise<Handedness | null> {
  if (!mlbPlayerId) return null;
  const player = await prisma.mlbPlayer.findUnique({ where: { id: mlbPlayerId }, select: { pitchHand: true } });
  return player?.pitchHand ?? null;
}

function battingFields(player: MlbBoxscorePlayer) {
  if (!player.batting) {
    return {
      atBats: null,
      plateAppearances: null,
      hits: null,
      totalBases: null,
      homeRuns: null,
      rbi: null,
      runs: null,
      baseOnBalls: null,
      strikeoutsBatting: null,
      stolenBases: null,
    };
  }
  const b = player.batting;
  return {
    atBats: b.atBats,
    plateAppearances: b.plateAppearances,
    hits: b.hits,
    totalBases: b.totalBases,
    homeRuns: b.homeRuns,
    rbi: b.rbi,
    runs: b.runs,
    baseOnBalls: b.baseOnBalls,
    strikeoutsBatting: b.strikeOuts,
    stolenBases: b.stolenBases,
  };
}

function pitchingFields(player: MlbBoxscorePlayer) {
  if (!player.pitching) {
    return {
      isStarter: null,
      outsRecorded: null,
      strikeoutsPitching: null,
      earnedRuns: null,
      hitsAllowed: null,
      walksAllowed: null,
    };
  }
  const p = player.pitching;
  return {
    isStarter: p.gamesStarted === 1,
    outsRecorded: p.outs,
    strikeoutsPitching: p.strikeOuts,
    earnedRuns: p.earnedRuns,
    hitsAllowed: p.hits,
    walksAllowed: p.baseOnBalls,
  };
}
