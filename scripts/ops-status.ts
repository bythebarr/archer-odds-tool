/**
 * Read-only health report on the production database: every job's last run and
 * status, how fresh each sport's odds and game logs are, and what the
 * all-sports engine holds. Run by the "Ops status" workflow; writes nothing.
 */
import { prisma } from "@/lib/prisma";

const ago = (d: Date | null | undefined) => (d ? `${Math.round((Date.now() - d.getTime()) / 3_600_000)}h ago` : "never");

async function main() {
  console.log("== Jobs (latest 60)");
  const logs = await prisma.pollLog.findMany({ orderBy: { lastPolledAt: "desc" }, take: 60 });
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
  console.log(`Prop lines now: NBA ${await prisma.currentNbaPropLine.count()}, NFL ${await prisma.currentNflPropLine.count()}`);

  console.log("\n== All-sports engine");
  const leagues = await prisma.league.groupBy({ by: ["provider", "active"], _count: { _all: true } });
  for (const g of leagues) console.log(`leagues provider=${g.provider} active=${g.active}: ${g._count._all}`);
  console.log(`events: ${await prisma.sportEvent.count()} (scheduled ${await prisma.sportEvent.count({ where: { status: "scheduled" } })}), lines: ${await prisma.sportEventLine.count()}, competitors: ${await prisma.competitor.count()}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
