import { prisma } from "@/lib/prisma";
import { getTeamFormForGame, getTeamFormBatch, type TeamForm } from "./teamForm";

export interface PitcherInfo {
  fullName: string;
  wins: number;
  losses: number;
  era: number | null;
  gamesStarted: number;
  /** Season innings pitched — lets expectedRuns.ts scale ERA to how much of a game this pitcher actually covers (see pitcherExpectedRuns), rather than treating ERA as if the starter pitches all 9 innings. Null on parse failure, same as era. */
  inningsPitched: number | null;
}

export interface GameMatchup {
  homePitcher: PitcherInfo | null;
  awayPitcher: PitcherInfo | null;
  homeForm: TeamForm;
  awayForm: TeamForm;
}

interface PitcherWithStats {
  fullName: string;
  seasonStats: {
    season: number;
    wins: number;
    losses: number;
    era: number | null;
    gamesStarted: number;
    inningsPitched: number | null;
  }[];
}

function toPitcherInfo(pitcher: PitcherWithStats | null, season: number): PitcherInfo | null {
  if (!pitcher) return null;
  const stats = pitcher.seasonStats.find((s) => s.season === season);
  return {
    fullName: pitcher.fullName,
    wins: stats?.wins ?? 0,
    losses: stats?.losses ?? 0,
    era: stats?.era ?? null,
    gamesStarted: stats?.gamesStarted ?? 0,
    inningsPitched: stats?.inningsPitched ?? null,
  };
}

/** Probable-pitcher + team-form context for one game — the "Archer method" comparison, surfaced for the user to read, not blended into EV. */
export async function getGameMatchup(gameId: string): Promise<GameMatchup | null> {
  const game = await prisma.game.findUnique({
    where: { id: gameId, sport: "mlb" },
    include: {
      homeProbablePitcher: { include: { seasonStats: true } },
      awayProbablePitcher: { include: { seasonStats: true } },
    },
  });
  // The DB CHECK constraint guarantees homeTeamId/awayTeamId are non-null
  // whenever sport is "mlb" (see the tennis plan doc), so this null check is
  // unreachable in practice — kept for type-correctness, not defensiveness.
  if (!game || game.homeTeamId === null || game.awayTeamId === null) return null;

  const { home: homeForm, away: awayForm } = await getTeamFormForGame(
    game.homeTeamId,
    game.awayTeamId,
    game.season
  );

  return {
    homePitcher: toPitcherInfo(game.homeProbablePitcher, game.season),
    awayPitcher: toPitcherInfo(game.awayProbablePitcher, game.season),
    homeForm,
    awayForm,
  };
}

/** Same matchup data as getGameMatchup, batched across many games in one query — the slate view needs this for every game on the day's card instead of one game+one team-form query pair per game. */
export async function getGameMatchupsBatch(gameIds: string[]): Promise<Record<string, GameMatchup | null>> {
  const games = await prisma.game.findMany({
    where: { id: { in: gameIds }, sport: "mlb" },
    include: {
      homeProbablePitcher: { include: { seasonStats: true } },
      awayProbablePitcher: { include: { seasonStats: true } },
    },
  });

  const result: Record<string, GameMatchup | null> = {};
  for (const gameId of gameIds) result[gameId] = null;
  if (games.length === 0) return result;

  const teamIds = new Set<string>();
  for (const game of games) {
    if (game.homeTeamId !== null) teamIds.add(game.homeTeamId);
    if (game.awayTeamId !== null) teamIds.add(game.awayTeamId);
  }
  // A batch call is always scoped to one ET calendar date's slate, so every game shares one season.
  const formByTeam = await getTeamFormBatch([...teamIds], games[0].season);

  for (const game of games) {
    if (game.homeTeamId === null || game.awayTeamId === null) continue;
    result[game.id] = {
      homePitcher: toPitcherInfo(game.homeProbablePitcher, game.season),
      awayPitcher: toPitcherInfo(game.awayProbablePitcher, game.season),
      homeForm: formByTeam[game.homeTeamId],
      awayForm: formByTeam[game.awayTeamId],
    };
  }
  return result;
}
