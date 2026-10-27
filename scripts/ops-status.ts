/**
 * Read-only health report on the production database: every job's last run and
 * status, how fresh each sport's odds and game logs are, and what the
 * all-sports engine holds. Run by the "Ops status" workflow; writes nothing.
 */
import { prisma } from "@/lib/prisma";

const ago = (d: Date | null | undefined) => (d ? `${Math.round((Date.now() - d.getTime()) / 3_600_000)}h ago` : "never");

async function main() {
  console.log("== Jobs (every job but per-league ESPN backfills, latest first)");
  const logs = await prisma.pollLog.findMany({ where: { NOT: [{ jobName: { startsWith: "espn-" } }, { jobName: { startsWith: "all-sports-spend" } }] }, orderBy: { lastPolledAt: "desc" }, take: 80 });
  for (const l of logs) console.log(`${l.jobName.padEnd(48)} ${ago(l.lastPolledAt).padStart(9)}  ${l.lastStatus.slice(0, 110)}${l.creditsRemaining !== null ? `  [credits left ${l.creditsRemaining}]` : ""}`);

  console.log("\n== Games by sport (scheduled within 7 days / latest odds)");
  for (const sport of ["nba", "nfl", "mlb"] as const) {
    const upcoming = await prisma.game.count({ where: { sport, status: "scheduled", scheduledStartUtc: { gte: new Date(), lte: new Date(Date.now() + 7 * 86_400_000) } } });
    const lastLine = await prisma.currentOddsLine.findFirst({ where: { game: { sport } }, orderBy: { polledAt: "desc" }, select: { polledAt: true } }).catch(() => null);
    console.log(`${sport}: ${upcoming} scheduled next 7d, last odds ${ago(lastLine?.polledAt)}`);
  }

  console.log("\n== Player game logs (latest game date)");
  const nba = await prisma.nbaPlayerGameLog.findFirst({ orderBy: { gameDate: "desc" }, select: { gameDate: true } });
  const nfl = await prisma.nflPlayerGameLog.findFirst({ orderBy: { gameDate: "desc" }, select: { gameDate: true } });
  console.log(`NBA ${nba?.gameDate.toISOString().slice(0, 10) ?? "none"} (${await prisma.nbaPlayerGameLog.count()} rows), NFL ${nfl?.gameDate.toISOString().slice(0, 10) ?? "none"} (${await prisma.nflPlayerGameLog.count()} rows)`);
  console.log(`NFL players with a team: ${await prisma.nflPlayer.count({ where: { teamId: { not: null } } })}`);
  const positions = await prisma.nflPlayer.groupBy({ by: ["position"], where: { teamId: { not: null } }, _count: { _all: true } });
  console.log(`NFL positions: ${positions.map((p) => `${p.position ?? "null"}=${p._count._all}`).join(", ")}`);
  const nflWeek = await prisma.game.findMany({ where: { sport: "nfl", scheduledStartUtc: { gte: new Date(), lte: new Date(Date.now() + 7 * 86_400_000) } }, select: { status: true, homeTeamId: true } });
  console.log(`NFL games next 7d: ${nflWeek.length} (${nflWeek.filter((g) => g.homeTeamId).length} with teams; statuses ${[...new Set(nflWeek.map((g) => g.status))].join("/")})`);
  console.log(`Prop lines now: NBA ${await prisma.currentNbaPropLine.count()}, NFL ${await prisma.currentNflPropLine.count()}`);

  console.log("\n== All-sports engine");
  const leagues = await prisma.league.groupBy({ by: ["provider", "active"], _count: { _all: true } });
  for (const g of leagues) console.log(`leagues provider=${g.provider} active=${g.active}: ${g._count._all}`);
  console.log(`events: ${await prisma.sportEvent.count()} (scheduled ${await prisma.sportEvent.count({ where: { status: "scheduled" } })}), lines: ${await prisma.sportEventLine.count()}, competitors: ${await prisma.competitor.count()}`);
  console.log(`soccer player stats: ${await prisma.soccerPlayerMatch.count()} lines, ${await prisma.soccerPlayer.count()} players (${await prisma.soccerPlayer.count({ where: { photoUrl: { not: null } } })} Wikipedia photos), ${await prisma.sportEvent.count({ where: { id: { startsWith: "espn:" }, status: "final", boxScoreAt: null, league: { sport: "soccer", espnPath: { not: null } } } })} matches left to read`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
