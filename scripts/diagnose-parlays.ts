import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { getNbaPropsSlate, toWireSlate } from "@/lib/queries/nbaProps";
import { unpackLog, type GameLogPoint } from "@/lib/nba/propsMath";
import { nbaFinderLegs } from "@/lib/nba/parlayLegs";
import { findParlays } from "@/lib/props/parlayFinder";
import { todayEt } from "@/lib/dateEt";
import { formatAmerican } from "@/lib/odds/americanOdds";

/**
 * Read-only: runs the NBA Parlay Finder on today's slate exactly as the page
 * does (default controls) and prints each game's best parlays by size, with
 * how long the search took. Run: `npm run diagnose:parlays`.
 */
async function main() {
  const slate = toWireSlate(await getNbaPropsSlate(process.env.DATE ?? todayEt()));
  const logs = Object.fromEntries(Object.entries(slate.logs).map(([id, l]) => [id, l.map(unpackLog)])) as Record<string, GameLogPoint[]>;
  console.log(`${slate.date}: ${slate.games.length} games, ${slate.props.length} props, ${slate.props.reduce((a, p) => a + p.quotes.length, 0)} quotes`);
  for (const g of slate.games) {
    const t0 = Date.now();
    const legs = nbaFinderLegs(slate, logs, g.id, { shortestPrice: -500 });
    const t1 = Date.now();
    const res = findParlays(legs, { seasons: [slate.season, slate.season - 1] });
    const t2 = Date.now();
    console.log(`\n${g.away.abbreviation} @ ${g.home.abbreviation}: ${legs.length} legs (${t1 - t0} ms), search ${t2 - t1} ms, sizes ${res.map((r) => r.size).join(",")}`);
    for (const r of res.filter((x) => [2, 3, 5, 8, 12, 15].includes(x.size))) {
      const p = r.parlays[0];
      console.log(
        `  ${r.size} legs: ${p.hits}/${p.shared} (${Math.round((100 * p.hits) / p.shared)}%), last ${p.last10.hits}/${p.last10.shared}, ${p.priceAmerican !== null ? formatAmerican(p.priceAmerican) : "—"}, model ${p.model !== null ? Math.round(p.model * 100) + "%" : "—"}`
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
