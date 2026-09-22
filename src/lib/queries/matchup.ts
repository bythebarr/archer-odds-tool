import { prisma } from "@/lib/prisma";
import { getTeamFormForGame, getTeamFormBatch, type TeamForm } from "./teamForm";
import { getBullpenFormForGame, getBullpenFormBatch, type BullpenSplit } from "./bullpenForm";
import { getPitcherStartSplits, type PitcherStartSplit, type PitcherStartSplits } from "./pitcherForm";

export interface PitcherInfo {
  fullName: string;
  wins: number;
  losses: number;
  era: number | null;
  gamesStarted: number;
  /** Season innings pitched — lets expectedRuns.ts scale ERA to how much of a game this pitcher actually covers (see pitcherExpectedRuns), rather than treating ERA as if the starter pitches all 9 innings. Null on parse failure, same as era. */
  inningsPitched: number | null;
  /** This pitcher's own last-10/last-5-start ERA split — see archer/pitcherRecency.ts. Blended with season era in winProbability.ts/expectedRuns.ts so a hot or cold recent stretch moves the model, not just the season aggregate. Null only when the pitcher has no starts logged yet this season/before this cutoff. */
  last10Starts: PitcherStartSplit | null;
  last5Starts: PitcherStartSplit | null;
}

export interface GameMatchup {
  homePitcher: PitcherInfo | null;
  awayPitcher: PitcherInfo | null;
  homeForm: TeamForm;
  awayForm: TeamForm;
  /** Each team's own trailing bullpen split — see archer/bullpenRate.ts. Null only when the team has no relief-appearance sample yet (expectedRuns.ts falls back to league average). */
  homeBullpen: BullpenSplit | null;
  awayBullpen: BullpenSplit | null;
}

interface PitcherWithStats {
  id: string;
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

function toPitcherInfo(
  pitcher: PitcherWithStats | null,
  season: number,
  starts: PitcherStartSplits | undefined
): PitcherInfo | null {
  if (!pitcher) return null;
  const stats = pitcher.seasonStats.find((s) => s.season === season);
  return {
    fullName: pitcher.fullName,
    wins: stats?.wins ?? 0,
    losses: stats?.losses ?? 0,
    era: stats?.era ?? null,
    gamesStarted: stats?.gamesStarted ?? 0,
    inningsPitched: stats?.inningsPitched ?? null,
    last10Starts: starts?.last10Starts ?? null,
    last5Starts: starts?.last5Starts ?? null,
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
  const { home: homeBullpen, away: awayBullpen } = await getBullpenFormForGame(
    game.homeTeamId,
    game.awayTeamId,
    game.season
  );
  const startsByPitcherId = await getPitcherStartSplits(
    [game.homeProbablePitcher?.id, game.awayProbablePitcher?.id],
    game.season
  );

  return {
    homePitcher: toPitcherInfo(game.homeProbablePitcher, game.season, startsByPitcherId[game.homeProbablePitcher?.id ?? ""]),
    awayPitcher: toPitcherInfo(game.awayProbablePitcher, game.season, startsByPitcherId[game.awayProbablePitcher?.id ?? ""]),
    homeForm,
    awayForm,
    homeBullpen,
    awayBullpen,
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
  const bullpenByTeam = await getBullpenFormBatch([...teamIds], games[0].season);
  const pitcherIds = games.flatMap((g) => [g.homeProbablePitcher?.id, g.awayProbablePitcher?.id]);
  const startsByPitcherId = await getPitcherStartSplits(pitcherIds, games[0].season);

  for (const game of games) {
    if (game.homeTeamId === null || game.awayTeamId === null) continue;
    result[game.id] = {
      homePitcher: toPitcherInfo(game.homeProbablePitcher, game.season, startsByPitcherId[game.homeProbablePitcher?.id ?? ""]),
      awayPitcher: toPitcherInfo(game.awayProbablePitcher, game.season, startsByPitcherId[game.awayProbablePitcher?.id ?? ""]),
      homeForm: formByTeam[game.homeTeamId],
      awayForm: formByTeam[game.awayTeamId],
      homeBullpen: bullpenByTeam[game.homeTeamId] ?? null,
      awayBullpen: bullpenByTeam[game.awayTeamId] ?? null,
    };
  }
  return result;
}
