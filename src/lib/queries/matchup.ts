import { prisma } from "@/lib/prisma";
import type { Handedness } from "@/generated/prisma/client";
import { getTeamFormForGame, getTeamFormBatch, type TeamForm } from "./teamForm";
import {
  getBullpenFormForGame,
  getBullpenFormBatch,
  getBullpenRecentWorkload,
  type BullpenSplit,
  type BullpenWorkload,
} from "./bullpenForm";
import {
  getPitcherStartSplits,
  getPitcherHandednessSplits,
  type PitcherStartSplit,
  type PitcherStartSplits,
  type PitcherHandednessSplits,
} from "./pitcherForm";
import { getTeamHandednessMix, type LineupHandednessMix } from "./lineupHandedness";
import type { PitcherHandSplit } from "@/lib/archer/pitcherPlatoon";
import type { GameWeatherConditions } from "@/lib/archer/weatherEffect";

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
  /** This pitcher's own throwing hand — see archer/pitcherPlatoon.ts / lineupHandedness.ts. */
  pitchHand: Handedness | null;
  /** This pitcher's own vs-LHB/vs-RHB rate-stat split — see archer/pitcherPlatoon.ts. Null until this season's MLB Stats API splits sync has data for him. */
  platoonVsLeft: PitcherHandSplit | null;
  platoonVsRight: PitcherHandSplit | null;
}

export interface GameMatchup {
  homePitcher: PitcherInfo | null;
  awayPitcher: PitcherInfo | null;
  homeForm: TeamForm;
  awayForm: TeamForm;
  /** Each team's own trailing bullpen split — see archer/bullpenRate.ts. Null only when the team has no relief-appearance sample yet (expectedRuns.ts falls back to league average). */
  homeBullpen: BullpenSplit | null;
  awayBullpen: BullpenSplit | null;
  /** Each team's own recent bullpen workload (last couple of games) — see archer/bullpenRate.ts's recentBullpenWorkload. Null only when the team has no relief-appearance sample in that window (expectedRuns.ts applies no fatigue penalty). */
  homeBullpenRecentWorkload: BullpenWorkload | null;
  awayBullpenRecentWorkload: BullpenWorkload | null;
  /** Each team's OWN season batting-handedness mix — see archer/lineupHandedness.ts. Used when THAT team is batting (i.e. homeLineupMix pairs with awayPitcher in expectedRuns.ts, not homePitcher). */
  homeLineupMix: LineupHandednessMix | null;
  awayLineupMix: LineupHandednessMix | null;
  /** Shared (not per-team) — see archer/weatherEffect.ts. Null when the game has no resolved venue or no forecast synced yet. */
  weather: GameWeatherConditions | null;
}

/** Builds the shared weather-conditions object from a game's venue + latest synced forecast — null if either piece is missing. */
function toWeatherConditions(
  venue: { azimuthDeg: number; roofType: string } | null,
  weather: { temperatureF: number; windMph: number; windFromDeg: number } | null
): GameWeatherConditions | null {
  if (!weather) return null;
  return {
    temperatureF: weather.temperatureF,
    windMph: weather.windMph,
    windFromDeg: weather.windFromDeg,
    venueAzimuthDeg: venue?.azimuthDeg ?? null,
    roofType: venue?.roofType ?? null,
  };
}

interface PitcherWithStats {
  /** The real-world MLB Advanced Media person id — the only identity this table shares with MlbPlayer/PlayerGameLog (they're separate tables with unrelated internal ids). Use this, never Pitcher.id, to look up anything keyed off PlayerGameLog (e.g. getPitcherStartSplits). */
  mlbPersonId: number;
  /** Pitcher.id itself — safe to use for anything keyed directly off the Pitcher table (e.g. getPitcherHandednessSplits, whose FK already resolves through Pitcher, not MlbPlayer). */
  id: string;
  fullName: string;
  pitchHand: Handedness | null;
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
  starts: PitcherStartSplits | undefined,
  platoon: PitcherHandednessSplits | undefined
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
    pitchHand: pitcher.pitchHand,
    platoonVsLeft: platoon?.vsLeft ?? null,
    platoonVsRight: platoon?.vsRight ?? null,
  };
}

/** Probable-pitcher + team-form context for one game — the "Archer method" comparison, surfaced for the user to read, not blended into EV. */
export async function getGameMatchup(gameId: string): Promise<GameMatchup | null> {
  const game = await prisma.game.findUnique({
    where: { id: gameId, sport: "mlb" },
    include: {
      homeProbablePitcher: { include: { seasonStats: true } },
      awayProbablePitcher: { include: { seasonStats: true } },
      venue: true,
      weather: true,
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
  const recentWorkloadByTeam = await getBullpenRecentWorkload(
    [game.homeTeamId, game.awayTeamId],
    game.season
  );
  const startsByPitcherId = await getPitcherStartSplits(
    [game.homeProbablePitcher?.mlbPersonId, game.awayProbablePitcher?.mlbPersonId],
    game.season
  );
  const platoonByPitcherId = await getPitcherHandednessSplits(
    [game.homeProbablePitcher?.id, game.awayProbablePitcher?.id],
    game.season
  );
  const lineupMixByTeam = await getTeamHandednessMix([game.homeTeamId, game.awayTeamId], game.season);

  return {
    homePitcher: toPitcherInfo(
      game.homeProbablePitcher,
      game.season,
      startsByPitcherId[String(game.homeProbablePitcher?.mlbPersonId ?? "")],
      platoonByPitcherId[game.homeProbablePitcher?.id ?? ""]
    ),
    awayPitcher: toPitcherInfo(
      game.awayProbablePitcher,
      game.season,
      startsByPitcherId[String(game.awayProbablePitcher?.mlbPersonId ?? "")],
      platoonByPitcherId[game.awayProbablePitcher?.id ?? ""]
    ),
    homeForm,
    awayForm,
    homeBullpen,
    awayBullpen,
    homeBullpenRecentWorkload: recentWorkloadByTeam[game.homeTeamId] ?? null,
    awayBullpenRecentWorkload: recentWorkloadByTeam[game.awayTeamId] ?? null,
    homeLineupMix: lineupMixByTeam[game.homeTeamId] ?? null,
    awayLineupMix: lineupMixByTeam[game.awayTeamId] ?? null,
    weather: toWeatherConditions(game.venue, game.weather),
  };
}

/** Same matchup data as getGameMatchup, batched across many games in one query — the slate view needs this for every game on the day's card instead of one game+one team-form query pair per game. */
export async function getGameMatchupsBatch(gameIds: string[]): Promise<Record<string, GameMatchup | null>> {
  const games = await prisma.game.findMany({
    where: { id: { in: gameIds }, sport: "mlb" },
    include: {
      homeProbablePitcher: { include: { seasonStats: true } },
      awayProbablePitcher: { include: { seasonStats: true } },
      venue: true,
      weather: true,
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
  const recentWorkloadByTeam = await getBullpenRecentWorkload([...teamIds], games[0].season);
  const lineupMixByTeam = await getTeamHandednessMix([...teamIds], games[0].season);
  const pitcherMlbPersonIds = games.flatMap((g) => [g.homeProbablePitcher?.mlbPersonId, g.awayProbablePitcher?.mlbPersonId]);
  const startsByPitcherId = await getPitcherStartSplits(pitcherMlbPersonIds, games[0].season);
  const pitcherIds = games.flatMap((g) => [g.homeProbablePitcher?.id, g.awayProbablePitcher?.id]);
  const platoonByPitcherId = await getPitcherHandednessSplits(pitcherIds, games[0].season);

  for (const game of games) {
    if (game.homeTeamId === null || game.awayTeamId === null) continue;
    result[game.id] = {
      homePitcher: toPitcherInfo(
        game.homeProbablePitcher,
        game.season,
        startsByPitcherId[String(game.homeProbablePitcher?.mlbPersonId ?? "")],
        platoonByPitcherId[game.homeProbablePitcher?.id ?? ""]
      ),
      awayPitcher: toPitcherInfo(
        game.awayProbablePitcher,
        game.season,
        startsByPitcherId[String(game.awayProbablePitcher?.mlbPersonId ?? "")],
        platoonByPitcherId[game.awayProbablePitcher?.id ?? ""]
      ),
      homeForm: formByTeam[game.homeTeamId],
      awayForm: formByTeam[game.awayTeamId],
      homeBullpen: bullpenByTeam[game.homeTeamId] ?? null,
      awayBullpen: bullpenByTeam[game.awayTeamId] ?? null,
      homeBullpenRecentWorkload: recentWorkloadByTeam[game.homeTeamId] ?? null,
      awayBullpenRecentWorkload: recentWorkloadByTeam[game.awayTeamId] ?? null,
      homeLineupMix: lineupMixByTeam[game.homeTeamId] ?? null,
      awayLineupMix: lineupMixByTeam[game.awayTeamId] ?? null,
      weather: toWeatherConditions(game.venue, game.weather),
    };
  }
  return result;
}
