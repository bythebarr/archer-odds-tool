import { prisma } from "@/lib/prisma";
import { getTeamFormForGame, type TeamForm } from "./teamForm";

export interface PitcherInfo {
  fullName: string;
  wins: number;
  losses: number;
  era: number | null;
  gamesStarted: number;
}

export interface GameMatchup {
  homePitcher: PitcherInfo | null;
  awayPitcher: PitcherInfo | null;
  homeForm: TeamForm;
  awayForm: TeamForm;
}

interface PitcherWithStats {
  fullName: string;
  seasonStats: { season: number; wins: number; losses: number; era: number | null; gamesStarted: number }[];
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
  };
}

/** Probable-pitcher + team-form context for one game — the "Archer method" comparison, surfaced for the user to read, not blended into EV. */
export async function getGameMatchup(gameId: string): Promise<GameMatchup | null> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      homeProbablePitcher: { include: { seasonStats: true } },
      awayProbablePitcher: { include: { seasonStats: true } },
    },
  });
  if (!game) return null;

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
