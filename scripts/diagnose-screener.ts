import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { mlbScreener, nbaScreener, nflScreener, soccerScreener, tennisScreener, ufcScreener } from "@/lib/screener/sources";
import { DEFAULT_FILTERS, screen, type ScreenFilters, type ScreenerProp } from "@/lib/screener/types";
import { formatAmerican } from "@/lib/odds/americanOdds";

/**
 * Read-only: builds the Props tab screener's pool from production the way the
 * page does (uncached), with each sport's size and build time (a cached entry
 * must stay under ~2 MB), then prints what a few screens return.
 * Run: `npm run diagnose:screener`.
 */
async function main() {
  const pool: ScreenerProp[] = [];
  for (const [name, build] of [["nba", nbaScreener], ["nfl", nflScreener], ["soccer", () => soccerScreener()], ["mlb", mlbScreener], ["ufc", () => ufcScreener()], ["tennis", tennisScreener]] as const) {
    const t = Date.now();
    const rows = await build().catch((e) => {
      console.error(`${name} failed:`, e);
      return [] as ScreenerProp[];
    });
    const main = rows.filter((r) => r.main);
    const kb = (list: ScreenerProp[]) => Math.round(JSON.stringify(list).length / 1024);
    const biggest = Math.max(...[true, false].flatMap((m) => [0, 1, 2, 3].map((i) => kb(rows.filter((r) => r.main === m).slice(i * 2500, (i + 1) * 2500)))));
    console.log(`${name}: biggest cached chunk ${biggest} KB`);
    console.log(`${name}: ${rows.length} props, ${((Date.now() - t) / 1000).toFixed(1)}s · main ${main.length} (${kb(main)} KB), alt ${rows.length - main.length} (${kb(rows.filter((r) => !r.main))} KB), priced ${rows.filter((r) => r.priceAmerican !== null).length}`);
    pool.push(...rows);
  }
  const runs: [string, Partial<ScreenFilters>][] = [
    ["every window 80%+ (main lines)", { all: 0.8 }],
    ["UFC, L5 80%+", { sport: "ufc", min: { l5: 0.8 } }],
    ["tennis, L10 70%+", { sport: "tennis", min: { l10: 0.7 } }],
    ["MLB, L10 70%+", { sport: "mlb", min: { l10: 0.7 } }],
    ["NBA points, L10 and this season 80%+", { sport: "nba", stat: "points", min: { l10: 0.8, szn: 0.8 } }],
    ["NFL, L5 100% and last season 70%+, alt lines too", { sport: "nfl", mainOnly: false, min: { l5: 1, last: 0.7 } }],
    ["soccer, L10 70%+, sorted by ARCHR", { sport: "soccer", min: { l10: 0.7 }, sort: "archr" }],
    ["any sport, ARCHR 60%+ and +3% edge, priced −200 to +150", { minArchr: 0.6, minEdge: 0.03, shortest: -200, longest: 150, sort: "edge" }],
  ];
  for (const [label, change] of runs) {
    const rows = screen(pool, { ...DEFAULT_FILTERS, ...change });
    console.log(`\n${label}: ${rows.length} props`);
    for (const p of rows.slice(0, 6)) {
      const r = (w: keyof ScreenerProp["rates"]) => (p.rates[w][1] ? `${p.rates[w][0]}/${p.rates[w][1]}` : "—");
      console.log(
        `  [${p.league}] ${p.player} ${p.side === "yes" ? `${p.statLabel} Yes` : `${p.side} ${p.point} ${p.statLabel}`} ${p.priceAmerican !== null ? formatAmerican(p.priceAmerican) : "—"} · L3 ${r("l3")} L5 ${r("l5")} L10 ${r("l10")} L15 ${r("l15")} szn ${r("szn")} last ${r("last")} · ARCHR ${p.archr !== null ? Math.round(p.archr * 100) + "%" : "—"}`
      );
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
