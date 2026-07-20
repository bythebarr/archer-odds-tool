import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { projectPropHit } from "@/lib/props/projection";

/**
 * Does the BALLPARK explain batter-prop residuals (hits / total bases / HR)?
 *
 * Park factors are largest on the offensive side — a hitter's park inflates
 * hits, extra-base hits and home runs. The batting projection is batter-ONLY
 * (his own trailing rate), blind to the yard. This asks whether a park's own
 * trailing rate of each stat predicts the residual the batter-only projection
 * leaves — the offensive mirror of the pitcher-K park study (matchup-park.ts).
 *
 * PA-confound honesty (the trap that shelved the platoon signal): a per-game
 * o0.5-style counting prop conflates skill with OPPORTUNITY (plate appearances),
 * and a high-offense park hands out more PA (more men on base → more batters). So
 * this ALSO reports, per prop, whether high-park games simply carry more PA — if
 * the whole "edge" is just extra PA the book already prices, it's an artifact, not
 * a wireable park skill signal. Unlike platoon's managerial pinch-hit artifact,
 * a park's PA bump is a real persistent property of the yard, but we surface it so
 * the call is made with eyes open.
 *
 * Lookahead-safe: park rate uses only games at that park strictly BEFORE the game;
 * the batter projection uses only his prior games this season.
 *
 * Run: `npm run matchup:batterpark`.
 */

const MIN_PARK_PA = 500;

interface ParkDay {
  date: Date;
  pa: number;
  hits: number;
  totalBases: number;
  homeRuns: number;
}

/** A park's trailing per-PA rate of one stat from games strictly before `date`, league-relative-ready. */
function parkTrailing(series: ParkDay[], date: Date, stat: (d: ParkDay) => number): number | null {
  let num = 0;
  let pa = 0;
  for (const g of series) {
    if (g.date >= date) break;
    num += stat(g);
    pa += g.pa;
  }
  return pa >= MIN_PARK_PA ? num / pa : null;
}

async function main() {
  console.log("Loading batting logs (park series + batter projection input)…");
  const batting = await prisma.playerGameLog.findMany({
    where: { plateAppearances: { not: null } },
    select: {
      mlbPlayerId: true,
      gameDate: true,
      hits: true,
      totalBases: true,
      homeRuns: true,
      plateAppearances: true,
      game: { select: { homeTeamId: true } },
    },
    orderBy: [{ mlbPlayerId: "asc" }, { gameDate: "asc" }],
  });

  // Park (home team) → date-sorted per-game totals across both lineups.
  const parkByDay = new Map<string, ParkDay & { park: string }>();
  let lgPA = 0;
  const lg = { hits: 0, totalBases: 0, homeRuns: 0 };
  for (const b of batting) {
    const park = b.game?.homeTeamId;
    if (b.plateAppearances === null || !park) continue;
    lgPA += b.plateAppearances;
    lg.hits += b.hits ?? 0;
    lg.totalBases += b.totalBases ?? 0;
    lg.homeRuns += b.homeRuns ?? 0;
    const key = `${park}|${b.gameDate.toISOString().slice(0, 10)}`;
    const cur = parkByDay.get(key) ?? { park, date: b.gameDate, pa: 0, hits: 0, totalBases: 0, homeRuns: 0 };
    cur.pa += b.plateAppearances;
    cur.hits += b.hits ?? 0;
    cur.totalBases += b.totalBases ?? 0;
    cur.homeRuns += b.homeRuns ?? 0;
    parkByDay.set(key, cur);
  }
  const parkSeries = new Map<string, ParkDay[]>();
  for (const g of parkByDay.values()) {
    const arr = parkSeries.get(g.park) ?? [];
    arr.push(g);
    parkSeries.set(g.park, arr);
  }
  for (const arr of parkSeries.values()) arr.sort((a, b) => a.date.getTime() - b.date.getTime());
  const lgRate = {
    hits: lg.hits / lgPA,
    totalBases: lg.totalBases / lgPA,
    homeRuns: lg.homeRuns / lgPA,
  };
  console.log(`League per-PA: hits ${(lgRate.hits * 100).toFixed(1)}%  TB ${(lgRate.totalBases * 100).toFixed(1)}%  HR ${(lgRate.homeRuns * 100).toFixed(1)}%  · ${parkSeries.size} parks.\n`);

  const PROPS = [
    { label: "Hits o0.5", col: "hits" as const, line: 0.5, stat: (d: ParkDay) => d.hits, lg: lgRate.hits },
    { label: "Total Bases o1.5", col: "totalBases" as const, line: 1.5, stat: (d: ParkDay) => d.totalBases, lg: lgRate.totalBases },
    { label: "Home Runs o0.5", col: "homeRuns" as const, line: 0.5, stat: (d: ParkDay) => d.homeRuns, lg: lgRate.homeRuns },
  ];

  for (const P of PROPS) {
    const base = batting.reduce((a, r) => a + ((r[P.col] ?? 0) > P.line ? 1 : 0), 0) / batting.length;
    interface Row { hit: number; proj: number; parkRel: number; pa: number; date: Date }
    const rows: Row[] = [];

    let curPlayer = "";
    let curYear = -1;
    let seasonHits = 0;
    let seasonSample = 0;
    const recent: number[] = [];
    for (const b of batting) {
      const year = b.gameDate.getUTCFullYear();
      if (b.mlbPlayerId !== curPlayer || year !== curYear) {
        curPlayer = b.mlbPlayerId;
        curYear = year;
        seasonHits = 0;
        seasonSample = 0;
        recent.length = 0;
      }
      const hit = (b[P.col] ?? 0) > P.line ? 1 : 0;
      const park = b.game?.homeTeamId;
      const series = park ? parkSeries.get(park) : undefined;
      const parkRate = series ? parkTrailing(series, b.gameDate, P.stat) : null;
      const parkRel = parkRate === null ? 0 : parkRate - P.lg;

      if (seasonSample > 0) {
        const recentRate = recent.length ? recent.reduce((a, x) => a + x, 0) / recent.length : null;
        const proj = projectPropHit({ seasonHits, seasonSample, recentRate, baseRate: base });
        if (proj) rows.push({ hit, proj: proj.probability, parkRel, pa: b.plateAppearances ?? 0, date: b.gameDate });
      }
      seasonHits += hit;
      seasonSample += 1;
      recent.push(hit);
      if (recent.length > 10) recent.shift();
    }

    const withPark = rows.filter((r) => r.parkRel !== 0).sort((a, b) => a.parkRel - b.parkRel);
    const t = Math.floor(withPark.length / 3);
    const buckets = [withPark.slice(0, t), withPark.slice(t, 2 * t), withPark.slice(2 * t)];
    const gaps = buckets.map((bk) => (bk.reduce((a, r) => a + (r.hit - r.proj), 0) / bk.length) * 100);
    // PA-confound probe: mean PA in the low-park vs high-park tercile.
    const paLo = buckets[0].reduce((a, r) => a + r.pa, 0) / buckets[0].length;
    const paHi = buckets[2].reduce((a, r) => a + r.pa, 0) / buckets[2].length;

    // OOS park term: fit beta on older 70%, judge Brier on newer 30%.
    const sorted = [...withPark].sort((a, b) => a.date.getTime() - b.date.getTime());
    const cut = Math.floor(sorted.length * 0.7);
    const train = sorted.slice(0, cut);
    const val = sorted.slice(cut);
    let sxy = 0;
    let sxx = 0;
    for (const r of train) {
      sxy += r.parkRel * (r.hit - r.proj);
      sxx += r.parkRel * r.parkRel;
    }
    const beta = sxx > 0 ? sxy / sxx : 0;
    const clamp = (p: number) => Math.min(Math.max(p, 0.02), 0.98);
    const brier = (fn: (r: Row) => number) => val.reduce((a, r) => a + (fn(r) - r.hit) ** 2, 0) / val.length;
    const bd = brier((r) => r.proj);
    const ba = brier((r) => clamp(r.proj + beta * r.parkRel));
    let axy = 0;
    let axx = 0;
    for (const r of withPark) {
      axy += r.parkRel * (r.hit - r.proj);
      axx += r.parkRel * r.parkRel;
    }
    const betaAll = axx > 0 ? axy / axx : 0;

    console.log(`── ${P.label}  (n ${withPark.length}, base ${(base * 100).toFixed(1)}%) ${"─".repeat(18)}`);
    console.log(
      `  residual by park rate:  low ${gaps[0].toFixed(1)}   avg ${gaps[1].toFixed(1)}   high ${gaps[2].toFixed(1)}   spread ${(gaps[2] - gaps[0]).toFixed(1)}pt`
    );
    console.log(`  PA-confound probe:  low-park ${paLo.toFixed(2)} PA/g vs high-park ${paHi.toFixed(2)} PA/g  (Δ ${(paHi - paLo).toFixed(2)})`);
    console.log(`  OOS park term:  beta ${beta.toFixed(2)}   val Brier ${bd.toFixed(4)} → ${ba.toFixed(4)}  (${ba < bd ? "IMPROVES" : "no gain"})`);
    console.log(`  all-data beta (for wiring): ${betaAll.toFixed(4)}\n`);
  }
  console.log("Spread + Brier improvement + a PA gap that's SMALL relative to the spread = a real park skill signal worth wiring.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
