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

  // NBA: game logs by season (the board's "This szn" / "Last szn" windows read these).
  const nbaLogs = await prisma.nbaPlayerGameLog.groupBy({ by: ["season"], _count: true, _min: { gameDate: true }, _max: { gameDate: true } });
  console.log(
    `NbaPlayerGameLog by season:`,
    nbaLogs.map((l) => `${l.season}: ${l._count} (${l._min.gameDate?.toISOString().slice(0, 10)} → ${l._max.gameDate?.toISOString().slice(0, 10)})`).join(", ")
  );

  // Closing lines: what the game-model backtest measures itself against.
  for (const sport of ["nba", "nfl", "mlb"] as const) {
    const finals = await prisma.game.findMany({ where: { sport, status: "final", scheduledStartUtc: { gte: new Date(now.getTime() - 30 * day) } }, select: { id: true, scheduledStartUtc: true } });
    const ids = finals.map((g) => g.id);
    const [withClosing, snaps, preStart] = await Promise.all([
      prisma.gameClosingLine.groupBy({ by: ["gameId"], where: { gameId: { in: ids } } }),
      prisma.oddsSnapshot.groupBy({ by: ["gameId"], where: { gameId: { in: ids } } }),
      prisma.$queryRaw<{ n: bigint }[]>`SELECT count(DISTINCT s."gameId") AS n FROM "OddsSnapshot" s JOIN "Game" g ON g.id = s."gameId" WHERE g.id = ANY(${ids}) AND s."polledAt" < g."scheduledStartUtc"`,
    ]);
    console.log(`${sport}: ${finals.length} finals in 30 days; ${snaps.length} with any odds snapshot, ${Number(preStart[0]?.n ?? 0)} with a pre-start snapshot, ${withClosing.length} with a closing line`);
  }
  const oldest = await prisma.oddsSnapshot.findFirst({ orderBy: { polledAt: "asc" }, select: { polledAt: true } });
  console.log(`Oldest odds snapshot kept: ${oldest?.polledAt.toISOString() ?? "none"}`);

  // UFC: red-corner win rate by year. A symmetric fight model assumes the corner
  // means little; a source that lists the winner first would show up here.
  const ufc = await prisma.$queryRaw<{ yr: number; n: bigint; red: bigint; archive: bigint }[]>`
    SELECT EXTRACT(YEAR FROM e."eventDate")::int AS yr, count(*) AS n,
      count(*) FILTER (WHERE b."winnerFighterId" = b."redCornerFighterId") AS red,
      count(*) FILTER (WHERE b."ufcStatsId" IS NOT NULL) AS archive
    FROM "UfcBout" b JOIN "UfcEvent" e ON e.id = b."eventId"
    WHERE b."winnerFighterId" IS NOT NULL GROUP BY 1 ORDER BY 1`;
  console.log(`UFC decided bouts by year (red-corner win %, % from the UFCStats archive):`);
  for (const r of ufc) console.log(`  ${r.yr}: ${r.n} bouts, red ${Math.round((Number(r.red) / Number(r.n)) * 100)}%, archive ${Math.round((Number(r.archive) / Number(r.n)) * 100)}%`);

  // UFC duplicates: the same pair of fighters in two completed bouts within 3 days,
  // events within 2 days of each other, fighters sharing a name, and future "results".
  const dupBouts = await prisma.$queryRaw<{ yr: number; n: bigint; sameEvent: bigint }[]>`
    SELECT EXTRACT(YEAR FROM e1."eventDate")::int AS yr, count(*) AS n, count(*) FILTER (WHERE b1."eventId" = b2."eventId") AS "sameEvent"
    FROM "UfcBout" b1 JOIN "UfcEvent" e1 ON e1.id = b1."eventId"
    JOIN "UfcBout" b2 ON b2.id > b1.id
      AND LEAST(b2."redCornerFighterId", b2."blueCornerFighterId") = LEAST(b1."redCornerFighterId", b1."blueCornerFighterId")
      AND GREATEST(b2."redCornerFighterId", b2."blueCornerFighterId") = GREATEST(b1."redCornerFighterId", b1."blueCornerFighterId")
    JOIN "UfcEvent" e2 ON e2.id = b2."eventId" AND abs(extract(epoch FROM e2."eventDate" - e1."eventDate")) < 3 * 86400
    WHERE b1.status = 'completed' AND b2.status = 'completed' GROUP BY 1 ORDER BY 1`;
  console.log(`UFC duplicate completed bouts (same fighter pair, ≤3 days apart):`, dupBouts.map((r) => `${r.yr}: ${r.n} (${r.sameEvent} same event)`).join(", ") || "none");
  const dupEvents = await prisma.$queryRaw<{ a: string; b: string; da: Date; db: Date; ca: string; cb: string }[]>`
    SELECT e1.title AS a, e2.title AS b, e1."eventDate" AS da, e2."eventDate" AS db, e1."citoEventId" AS ca, e2."citoEventId" AS cb
    FROM "UfcEvent" e1 JOIN "UfcEvent" e2 ON e2.id > e1.id AND abs(extract(epoch FROM e2."eventDate" - e1."eventDate")) < 2 * 86400
    WHERE e1."eventDate" > '2024-06-01' ORDER BY e1."eventDate" LIMIT 12`;
  console.log(`UFC events within 2 days of another (since mid-2024, first 12):`);
  for (const e of dupEvents) console.log(`  ${e.da.toISOString().slice(0, 10)} "${e.a}" [${e.ca}] ~ ${e.db.toISOString().slice(0, 10)} "${e.b}" [${e.cb}]`);
  const dupFighters = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM (SELECT lower("fullName") FROM "UfcFighter" GROUP BY 1 HAVING count(*) > 1) x`;
  console.log(`UFC fighter names held by more than one row: ${Number(dupFighters[0]?.n ?? 0)}`);
  const future = await prisma.$queryRaw<{ title: string; d: Date; n: bigint; cito: string }[]>`
    SELECT e.title, e."eventDate" AS d, e."citoEventId" AS cito, count(*) AS n FROM "UfcBout" b JOIN "UfcEvent" e ON e.id = b."eventId"
    WHERE b."winnerFighterId" IS NOT NULL AND e."eventDate" > now() GROUP BY 1, 2, 4 ORDER BY 2`;
  for (const f of future) console.log(`  future event with results: ${f.d.toISOString().slice(0, 10)} "${f.title}" [${f.cito}] ${f.n} bouts`);

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
