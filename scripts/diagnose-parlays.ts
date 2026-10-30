import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { getNbaPropsSlate, toWireSlate } from "@/lib/queries/nbaProps";
import { unpackLog, type GameLogPoint } from "@/lib/nba/propsMath";
import { nbaFinderLegs } from "@/lib/nba/parlayLegs";
import { findParlays, type FinderLeg, type FinderOptions } from "@/lib/props/parlayFinder";
import { getNflPostedLines, getNflPropsSlate } from "@/lib/queries/nflProps";
import { unpackNflLog, type NflLogPoint } from "@/lib/nfl/propsMath";
import { nflFinderLegs } from "@/lib/nfl/parlayLegs";
import { todayEt } from "@/lib/dateEt";
import { formatAmerican } from "@/lib/odds/americanOdds";

/**
 * Read-only: runs the NBA Parlay Finder on today's slate exactly as the page
 * does (default controls) and prints each game's best parlays by size, with
 * how long the search took. Run: `npm run diagnose:parlays`.
 */
async function main() {
  // Every job polled in the last day, each tick record beside the job's own log.
  const logsOf = await prisma.pollLog.findMany({ where: { lastPolledAt: { gte: new Date(Date.now() - 86_400_000) } }, orderBy: { jobName: "asc" }, select: { jobName: true, lastPolledAt: true, lastStatus: true } });
  for (const l of logsOf) console.log(`poll ${l.jobName}: ${l.lastPolledAt.toISOString()} ${String(l.lastStatus).slice(0, 300)}`);
  const byLeague = await prisma.eventPropLine.groupBy({ by: ["league"], _count: true });
  console.log("EventPropLine:", byLeague.map((r) => `${r.league} ${r._count}`).join(", ") || "empty");
  console.log("EventPropLine NBA with a game:", await prisma.eventPropLine.count({ where: { league: "basketball/nba", eventRef: { not: null } } }), "· CurrentNbaPropLine:", await prisma.currentNbaPropLine.count());
  const slate = toWireSlate(await getNbaPropsSlate(process.env.DATE ?? todayEt()));
  const logs = Object.fromEntries(Object.entries(slate.logs).map(([id, l]) => [id, l.map(unpackLog)])) as Record<string, GameLogPoint[]>;
  console.log(`${slate.date}: ${slate.games.length} games, ${slate.props.length} props, ${slate.props.reduce((a, p) => a + p.quotes.length, 0)} quotes`);
  for (const g of slate.games) report(`${g.away.abbreviation} @ ${g.home.abbreviation}`, () => nbaFinderLegs(slate, logs, g.id, { shortestPrice: -500 }), { seasons: [slate.season, slate.season - 1], minShared: 10 });

  const nfl = await getNflPropsSlate();
  const nflLogs = Object.fromEntries(Object.entries(nfl.logs).map(([id, l]) => [id, l.map(unpackNflLog)])) as Record<string, NflLogPoint[]>;
  const posted = await getNflPostedLines(nfl.games.map((g) => g.id));
  console.log(`\nNFL: ${nfl.games.length} games, ${nfl.props.filter((p) => p.quotes.length).length} priced props, ${Object.keys(posted).length} players with posted lines`);
  for (const g of nfl.games) report(`NFL ${g.away.abbreviation} @ ${g.home.abbreviation}`, () => nflFinderLegs(nfl, nflLogs, g.id, { shortestPrice: -500, posted }), { seasons: [nfl.season, nfl.season - 1], minShared: 8 });
}

/** The page's default (one leg per player) and the uncapped search, side by side. */
function report(label: string, build: () => FinderLeg[], opts: Partial<FinderOptions>) {
  const t0 = Date.now();
  const legs = build();
  if (!legs.length) return;
  const t1 = Date.now();
  for (const [mode, maxPerPlayer] of [["1 per player", 1], ["any", Infinity]] as const) {
    const t2 = Date.now();
    const res = findParlays(legs, { ...opts, maxPerPlayer });
    console.log(`\n${label} [${mode}]: ${legs.length} legs (${t1 - t0} ms), search ${Date.now() - t2} ms, sizes ${res.map((r) => r.size).join(",")}`);
    for (const r of res.filter((x) => [2, 3, 5, 8, 12, 15].includes(x.size))) {
      const p = r.parlays[0];
      const players = new Set(p.legs.map((l) => l.player)).size;
      console.log(
        `  ${r.size} legs, ${players} players: ${p.hits}/${p.shared} (${Math.round((100 * p.hits) / p.shared)}%), last ${p.last10.hits}/${p.last10.shared}, ${p.priceAmerican !== null ? formatAmerican(p.priceAmerican) : "—"}, model ${p.model !== null ? Math.round(p.model * 100) + "%" : "—"}`
      );
      console.log(`     ${p.legs.map((l) => `${l.playerName} ${l.sideLabel} ${l.point} ${l.statShort} (${l.priceAmerican !== null ? formatAmerican(l.priceAmerican) : "—"})`).join(" | ")}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
