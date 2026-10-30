import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { teamLeagueLegs } from "@/lib/builder/sources/teamLeague";
import { allSportsLegs } from "@/lib/builder/sources/allSports";
import { ufcLegs } from "@/lib/builder/sources/ufc";
import { buildParlays, type BuilderOptions } from "@/lib/builder/build";
import type { BuilderLeg } from "@/lib/builder/types";
import { formatAmerican } from "@/lib/odds/americanOdds";

/**
 * Read-only: builds the Parlay Builder's leg pool from production the way the
 * page does (uncached), with each source's size and build time (the page caches
 * each source; a cached entry must stay under ~2 MB), then prints the parlays
 * a few settings produce. Run: `npm run diagnose:builder`.
 */
async function main() {
  const pool: BuilderLeg[] = [];
  for (const [name, build] of [
    ["nba", () => teamLeagueLegs("nba")],
    ["nfl", () => teamLeagueLegs("nfl")],
    ["ufc", () => ufcLegs()],
    ["all", () => allSportsLegs()],
  ] as const) {
    const t = Date.now();
    const legs = await build().catch((e) => {
      console.error(`${name} failed:`, e);
      return [] as BuilderLeg[];
    });
    const bySport = new Map<string, number>();
    const byKind = new Map<string, number>();
    for (const l of legs) {
      bySport.set(l.sport, (bySport.get(l.sport) ?? 0) + 1);
      byKind.set(l.kind, (byKind.get(l.kind) ?? 0) + 1);
    }
    const kb = Math.round(JSON.stringify(legs).length / 1024);
    console.log(`${name}: ${legs.length} legs, ${kb} KB, ${((Date.now() - t) / 1000).toFixed(1)}s · ${[...byKind].map(([k, n]) => `${k} ${n}`).join(", ")} · ${[...bySport].map(([k, n]) => `${k} ${n}`).join(", ")}`);
    pool.push(...legs);
  }

  const base: BuilderOptions = { sports: [], legs: 4, window: "l10", minRate: 0.7, minArchr: 0, minEdge: null, sameGame: false, sort: "archr", count: 3 };
  const runs: [string, Partial<BuilderOptions>][] = [
    ["default (4 legs, 70% L10, rank by ARCHR)", {}],
    ["6 legs, 80% L10, ARCHR 60%+", { legs: 6, minRate: 0.8, minArchr: 0.6 }],
    ["3 legs, +3% ARCHR edge, 60% L20", { legs: 3, minEdge: 0.03, minRate: 0.6, window: "l20", sort: "edge" }],
    ["NBA only, 5 legs, same-game on", { sports: ["nba"], legs: 5, sameGame: true }],
    ["soccer only, 4 legs, 60% season", { sports: ["soccer"], minRate: 0.6, window: "season" }],
    ["UFC only, 3 legs, 60% L5", { sports: ["ufc"], legs: 3, minRate: 0.6, window: "l5" }],
  ];
  for (const [label, change] of runs) {
    const t = Date.now();
    const { qualifying, parlays } = buildParlays(pool, { ...base, ...change });
    console.log(`\n${label}: ${qualifying} legs qualify, ${parlays.length} parlays (${Date.now() - t} ms)`);
    for (const p of parlays.slice(0, 2)) {
      console.log(`  ${p.priceAmerican !== null ? formatAmerican(p.priceAmerican) : "—"} · ARCHR ${p.archr !== null ? Math.round(p.archr * 100) + "%" : "—"} · records ${Math.round(p.record * 100)}% · edge ${p.edge !== null ? (p.edge * 100).toFixed(1) + "%" : "—"}`);
      for (const l of p.legs) {
        const [h, n] = l.rates[change.window ?? base.window];
        console.log(`     [${l.league}] ${l.label} (${l.eventLabel}) ${l.priceAmerican !== null ? formatAmerican(l.priceAmerican) : "—"} · ${h}/${n} · ARCHR ${l.archr !== null ? Math.round(l.archr * 100) + "%" : "—"}`);
      }
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
