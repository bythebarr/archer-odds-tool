import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type { Handedness } from "@/generated/prisma/client";

export interface MlbPlayerSummary {
  id: string;
  mlbPersonId: number;
  fullName: string;
  batSide: Handedness | null;
  pitchHand: Handedness | null;
}

export const getMlbPlayerById = cache(async function getMlbPlayerById(
  mlbPlayerId: string
): Promise<MlbPlayerSummary | null> {
  return prisma.mlbPlayer.findUnique({
    where: { id: mlbPlayerId },
    select: { id: true, mlbPersonId: true, fullName: true, batSide: true, pitchHand: true },
  });
});

/** Name search for the props hub — skips the query entirely on 0-1 char input to avoid a table scan. */
export async function searchMlbPlayers(query: string, limit = 20): Promise<MlbPlayerSummary[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  return prisma.mlbPlayer.findMany({
    where: { fullName: { contains: trimmed, mode: "insensitive" } },
    orderBy: { fullName: "asc" },
    take: limit,
    select: { id: true, mlbPersonId: true, fullName: true, batSide: true, pitchHand: true },
  });
}

export interface RecentTeamPlayer {
  player: MlbPlayerSummary;
  lastGameDate: Date;
}

const RECENT_PLAYER_WINDOW_DAYS = 45;

/**
 * Approximates "who's relevant to this team right now" since batters aren't
 * tracked as probable starters the way pitchers are (see MlbPlayer's
 * docstring) — most-recently-active players from game logs, not a lineup.
 * Deliberately doesn't combine Prisma's `distinct` with `take` (dedup +
 * pagination interact unreliably together) — instead bounds the row count
 * with a recency window, then slices in JS after `distinct` runs over the
 * full ordered set.
 */
export async function getRecentTeamPlayers(teamId: string, limit = 15): Promise<RecentTeamPlayer[]> {
  const cutoff = new Date(Date.now() - RECENT_PLAYER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const rows = await prisma.playerGameLog.findMany({
    where: { teamId, gameDate: { gte: cutoff } },
    orderBy: { gameDate: "desc" },
    distinct: ["mlbPlayerId"],
    include: { mlbPlayer: { select: { id: true, mlbPersonId: true, fullName: true, batSide: true, pitchHand: true } } },
  });

  return rows.slice(0, limit).map((r) => ({ player: r.mlbPlayer, lastGameDate: r.gameDate }));
}

export async function getRecentTeamPlayersBatch(
  teamIds: string[],
  limit = 15
): Promise<Record<string, RecentTeamPlayer[]>> {
  const cutoff = new Date(Date.now() - RECENT_PLAYER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const rows = await prisma.playerGameLog.findMany({
    where: { teamId: { in: teamIds }, gameDate: { gte: cutoff } },
    orderBy: { gameDate: "desc" },
    distinct: ["teamId", "mlbPlayerId"],
    include: { mlbPlayer: { select: { id: true, mlbPersonId: true, fullName: true, batSide: true, pitchHand: true } } },
  });

  const byTeam: Record<string, RecentTeamPlayer[]> = {};
  for (const teamId of teamIds) byTeam[teamId] = [];
  for (const row of rows) {
    const list = byTeam[row.teamId];
    if (list.length < limit) list.push({ player: row.mlbPlayer, lastGameDate: row.gameDate });
  }
  return byTeam;
}

/**
 * The opposing probable starter's throwing hand for a given game/team side —
 * `Pitcher` (used for Game.home/awayProbablePitcher) has no handedness field
 * of its own, so this joins across to MlbPlayer via the shared mlbPersonId
 * space (a real two-way player has independent rows in both tables under the
 * same id — see MlbPlayer's docstring). Returns null (no highlight, not an
 * error) whenever the game, probable pitcher, or matching MlbPlayer row is
 * missing — never attempts to re-derive the team from game logs.
 */
export async function getOpposingProbableHand(
  gameId: string,
  playerTeamId: string
): Promise<Handedness | null> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      homeTeamId: true,
      awayTeamId: true,
      homeProbablePitcher: { select: { mlbPersonId: true } },
      awayProbablePitcher: { select: { mlbPersonId: true } },
    },
  });
  if (!game) return null;

  const opposingPitcher = playerTeamId === game.homeTeamId ? game.awayProbablePitcher : game.homeProbablePitcher;
  if (!opposingPitcher) return null;

  const opposingAsMlbPlayer = await prisma.mlbPlayer.findUnique({
    where: { mlbPersonId: opposingPitcher.mlbPersonId },
    select: { pitchHand: true },
  });
  return opposingAsMlbPlayer?.pitchHand ?? null;
}
