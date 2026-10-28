import "dotenv/config";
import { prisma } from "@/lib/prisma";

/**
 * Read-only: counts the rows each props board is built from, so an empty board
 * in production can be traced to the missing link (games, roster, logs, lines,
 * ratings). Writes nothing. Run: `npm run diagnose:props`.
 */
async function main() {
  const now = new Date();
  const day = 86_400_000;

  // NFL: the props slate = this week's games → players on those teams → their recent logs.
  const games = await prisma.game.findMany({
    where: { sport: "nfl", scheduledStartUtc: { gte: new Date(now.getTime() - 3 * 3_600_000), lte: new Date(now.getTime() + 7 * day) }, status: { not: "final" } },
    select: { id: true, scheduledStartUtc: true, homeTeamId: true, awayTeamId: true, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } },
  });
  const teamIds = games.flatMap((g) => [g.homeTeamId, g.awayTeamId]).filter((t): t is string => !!t);
  console.log(`NFL games next 7 days: ${games.length} (missing a team id: ${games.filter((g) => !g.homeTeamId || !g.awayTeamId).length})`);
  for (const g of games.slice(0, 4)) console.log(`  ${g.scheduledStartUtc.toISOString()} ${g.awayTeam?.name} @ ${g.homeTeam?.name}`);

  const [players, playersNoTeam, onSlateTeams, logs, logsRecent, lines] = await Promise.all([
    prisma.nflPlayer.count(),
    prisma.nflPlayer.count({ where: { teamId: null } }),
    prisma.nflPlayer.count({ where: { teamId: { in: teamIds } } }),
    prisma.nflPlayerGameLog.groupBy({ by: ["season"], _count: true, _max: { gameDate: true } }),
    prisma.nflPlayerGameLog.count({ where: { gameDate: { gte: new Date(now.getTime() - 70 * day), lt: now } } }),
    prisma.currentNflPropLine.count(),
  ]);
  console.log(`NflPlayer: ${players} total, ${playersNoTeam} with no team, ${onSlateTeams} on this week's teams`);
  console.log(`NflPlayerGameLog by season:`, logs.map((l) => `${l.season}: ${l._count} (latest ${l._max.gameDate?.toISOString().slice(0, 10)})`).join(", "));
  console.log(`NflPlayerGameLog last 70 days: ${logsRecent}`);
  console.log(`CurrentNflPropLine rows: ${lines}`);

  // Do the players' teams and the games' teams point at the same Team rows?
  const playerTeams = await prisma.nflPlayer.groupBy({ by: ["teamId"], _count: true });
  const teamRows = await prisma.team.findMany({ where: { id: { in: playerTeams.map((p) => p.teamId).filter((t): t is string => !!t) } }, select: { id: true, name: true, league: true } });
  console.log(`NflPlayer teams: ${playerTeams.length} distinct; sample:`, teamRows.slice(0, 4).map((t) => `${t.name} [${t.league}] ${t.id}`).join(" | "));
  const slateTeams = await prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true, league: true } });
  console.log(`This week's game teams; sample:`, slateTeams.slice(0, 4).map((t) => `${t.name} [${t.league}] ${t.id}`).join(" | "));
  const sameName = await prisma.team.groupBy({ by: ["name"], where: { name: { in: slateTeams.map((t) => t.name) } }, _count: true });
  console.log(`Team rows per slate team name (>1 = duplicates):`, sameName.filter((s) => s._count > 1).map((s) => `${s.name}×${s._count}`).join(", ") || "none");

  // Tennis: the archive and ratings the props board reads.
  const [archive, ratings, distinctOverall] = await Promise.all([
    prisma.tennisArchiveMatch.count(),
    prisma.tennisRating.count(),
    prisma.tennisRating.groupBy({ by: ["overall"], _count: true }),
  ]);
  console.log(`TennisArchiveMatch: ${archive}; TennisRating: ${ratings} (${distinctOverall.length} distinct Elo values)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
