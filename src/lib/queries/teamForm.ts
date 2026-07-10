import { prisma } from "@/lib/prisma";

export interface RecordSplit {
  wins: number;
  losses: number;
  gamesFound: number;
  record: string;
}

/** Runs scored ("for") and allowed ("against") over some window, the raw inputs to the Archer expected-runs model (see archer/expectedRuns.ts). */
export interface RunsSplit {
  runsFor: number;
  runsAgainst: number;
  gamesFound: number;
}

export interface TeamForm {
  homeRecord: RecordSplit; // this team's record when playing at home
  awayRecord: RecordSplit; // this team's record when playing away
  last5: RecordSplit;
  last10: RecordSplit;
  runsSeason: RunsSplit;
  runsLast10: RunsSplit;
  runsLast5: RunsSplit;
}

function reduceRecordSplit(games: { win: boolean }[]): RecordSplit {
  const wins = games.filter((g) => g.win).length;
  const losses = games.length - wins;
  return { wins, losses, gamesFound: games.length, record: `${wins}-${losses}` };
}

function reduceRunsSplit(games: { teamScore: number; oppScore: number }[]): RunsSplit {
  return {
    runsFor: games.reduce((sum, g) => sum + g.teamScore, 0),
    runsAgainst: games.reduce((sum, g) => sum + g.oppScore, 0),
    gamesFound: games.length,
  };
}

interface FinishedGame {
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeScore: number | null;
  awayScore: number | null;
}

function formForTeam(teamId: string, games: FinishedGame[]): TeamForm {
  const teamGames = games
    .filter((g) => g.homeTeamId === teamId || g.awayTeamId === teamId)
    .filter((g) => g.homeScore !== null && g.awayScore !== null)
    .map((g) => {
      const isHome = g.homeTeamId === teamId;
      const teamScore = isHome ? g.homeScore! : g.awayScore!;
      const oppScore = isHome ? g.awayScore! : g.homeScore!;
      return { isHome, win: teamScore > oppScore, teamScore, oppScore };
    });

  return {
    homeRecord: reduceRecordSplit(teamGames.filter((g) => g.isHome)),
    awayRecord: reduceRecordSplit(teamGames.filter((g) => !g.isHome)),
    last5: reduceRecordSplit(teamGames.slice(0, 5)),
    last10: reduceRecordSplit(teamGames.slice(0, 10)),
    runsSeason: reduceRunsSplit(teamGames),
    runsLast10: reduceRunsSplit(teamGames.slice(0, 10)),
    runsLast5: reduceRunsSplit(teamGames.slice(0, 5)),
  };
}

/**
 * Home/away/last-5/last-10 form for both teams in a matchup, computed from
 * our own Game table (same "computed on read" pattern as hit-rate) rather
 * than MLB's standings endpoint — one source of truth for "how has this team
 * actually been playing," reusing the schedule/results sync we already run.
 * Resets every season, matching how MLB's own splits work.
 */
export async function getTeamFormForGame(
  homeTeamId: string,
  awayTeamId: string,
  season: number,
  before?: Date
): Promise<{ home: TeamForm; away: TeamForm }> {
  const games = await prisma.game.findMany({
    where: {
      sport: "mlb",
      season,
      status: "final",
      // before (backtesting only): form as it stood ahead of a target game —
      // only games that had already finished before it, so a historical
      // projection can't see the results of that game or any later one.
      ...(before ? { scheduledStartUtc: { lt: before } } : {}),
      OR: [{ homeTeamId: { in: [homeTeamId, awayTeamId] } }, { awayTeamId: { in: [homeTeamId, awayTeamId] } }],
    },
    orderBy: { scheduledStartUtc: "desc" },
    select: { homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
  });

  return { home: formForTeam(homeTeamId, games), away: formForTeam(awayTeamId, games) };
}

/** Same form computation as getTeamFormForGame, batched across many teams in one query — the slate view needs every team's form on the day's card at once instead of one query pair per game. */
export async function getTeamFormBatch(teamIds: string[], season: number): Promise<Record<string, TeamForm>> {
  const uniqueIds = [...new Set(teamIds)];

  const games = await prisma.game.findMany({
    where: {
      sport: "mlb",
      season,
      status: "final",
      OR: [{ homeTeamId: { in: uniqueIds } }, { awayTeamId: { in: uniqueIds } }],
    },
    orderBy: { scheduledStartUtc: "desc" },
    select: { homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
  });

  const result: Record<string, TeamForm> = {};
  for (const teamId of uniqueIds) {
    result[teamId] = formForTeam(teamId, games);
  }
  return result;
}
