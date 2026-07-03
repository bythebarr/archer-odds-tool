import { prisma } from "@/lib/prisma";

export interface RecordSplit {
  wins: number;
  losses: number;
  gamesFound: number;
  record: string;
}

export interface TeamForm {
  homeRecord: RecordSplit; // this team's record when playing at home
  awayRecord: RecordSplit; // this team's record when playing away
  last5: RecordSplit;
  last10: RecordSplit;
}

function reduceRecordSplit(games: { win: boolean }[]): RecordSplit {
  const wins = games.filter((g) => g.win).length;
  const losses = games.length - wins;
  return { wins, losses, gamesFound: games.length, record: `${wins}-${losses}` };
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
  season: number
): Promise<{ home: TeamForm; away: TeamForm }> {
  const games = await prisma.game.findMany({
    where: {
      season,
      status: "final",
      OR: [{ homeTeamId: { in: [homeTeamId, awayTeamId] } }, { awayTeamId: { in: [homeTeamId, awayTeamId] } }],
    },
    orderBy: { scheduledStartUtc: "desc" },
    select: { homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
  });

  function formFor(teamId: string): TeamForm {
    const teamGames = games
      .filter((g) => g.homeTeamId === teamId || g.awayTeamId === teamId)
      .filter((g) => g.homeScore !== null && g.awayScore !== null)
      .map((g) => {
        const isHome = g.homeTeamId === teamId;
        const teamScore = isHome ? g.homeScore! : g.awayScore!;
        const oppScore = isHome ? g.awayScore! : g.homeScore!;
        return { isHome, win: teamScore > oppScore };
      });

    return {
      homeRecord: reduceRecordSplit(teamGames.filter((g) => g.isHome)),
      awayRecord: reduceRecordSplit(teamGames.filter((g) => !g.isHome)),
      last5: reduceRecordSplit(teamGames.slice(0, 5)),
      last10: reduceRecordSplit(teamGames.slice(0, 10)),
    };
  }

  return { home: formFor(homeTeamId), away: formFor(awayTeamId) };
}
