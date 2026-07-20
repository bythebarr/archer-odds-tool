import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { projectPropHit } from "@/lib/props/projection";

/**
 * Does the OPPOSING STARTER explain batter-prop residuals?
 *
 * The batting projection is batter-ONLY (his own trailing rate). But a hit or a
 * strikeout is two-sided: a batter fans more against a high-K starter and racks
 * up more hits against a soft-tossing one. Batting is the higher-VOLUME prop
 * market, so even a modest matchup edge there is worth more than the pitcher-K
 * one. This mirrors matchup-pitcher-k.ts on the other side of the plate.
 *
 * Signal tested (lookahead-safe — opposing pitcher's rate uses only his starts
 * BEFORE this game; batter projection uses only his prior games this season):
 *   - Batter Ks o0.5  vs the opposing starter's trailing K-per-batter-faced
 *   - Hits o0.5       vs the opposing starter's trailing hits-per-batter-faced
 *
 * Run: `npm run matchup:batter`.
 */

const MIN_BF = 200; // opposing starter needs a stable sample before we trust his rate

interface PitcherGame {
  date: Date;
  k: number;
  h: number;
  bf: number; // batters faced ≈ outs + hits + walks
}
/** A pitcher's trailing (K, hits) per batter-faced from starts strictly before `date`. */
function pitcherTrailing(series: PitcherGame[], date: Date): { kRate: number; hRate: number } | null {
  let k = 0;
  let h = 0;
  let bf = 0;
  for (const g of series) {
    if (g.date >= date) break;
    k += g.k;
    h += g.h;
    bf += g.bf;
  }
  return bf >= MIN_BF ? { kRate: k / bf, hRate: h / bf } : null;
}

async function main() {
  console.log("Loading pitcher starts to build opposing-starter quality series…");
  const pitcherLogs = await prisma.playerGameLog.findMany({
    where: { isStarter: true },
    select: {
      mlbPlayerId: true,
      gameDate: true,
      strikeoutsPitching: true,
      hitsAllowed: true,
      outsRecorded: true,
      walksAllowed: true,
    },
  });
  const series = new Map<string, PitcherGame[]>();
  let lgK = 0;
  let lgH = 0;
  let lgBF = 0;
  for (const p of pitcherLogs) {
    const outs = p.outsRecorded ?? 0;
    const h = p.hitsAllowed ?? 0;
    const w = p.walksAllowed ?? 0;
    const bf = outs + h + w;
    if (bf <= 0) continue;
    const k = p.strikeoutsPitching ?? 0;
    lgK += k;
    lgH += h;
    lgBF += bf;
    const arr = series.get(p.mlbPlayerId) ?? [];
    arr.push({ date: p.gameDate, k, h, bf });
    series.set(p.mlbPlayerId, arr);
  }
  for (const arr of series.values()) arr.sort((a, b) => a.date.getTime() - b.date.getTime());
  const lgKRate = lgK / lgBF;
  const lgHRate = lgH / lgBF;
  console.log(`League: ${(lgKRate * 100).toFixed(1)}% K/BF, ${(lgHRate * 100).toFixed(1)}% hits/BF.\n`);

  console.log("Loading batting logs…");
  const batting = await prisma.playerGameLog.findMany({
    where: { plateAppearances: { not: null } },
    select: {
      mlbPlayerId: true,
      gameDate: true,
      hits: true,
      strikeoutsBatting: true,
      opposingStarterId: true,
    },
    orderBy: [{ mlbPlayerId: "asc" }, { gameDate: "asc" }],
  });

  // Two props, each paired with the opposing-pitcher rate that should drive it.
  const PROPS = [
    { label: "Batter Ks o0.5", col: "strikeoutsBatting" as const, line: 0.5, oppRate: (t: { kRate: number; hRate: number }) => t.kRate, lg: lgKRate },
    { label: "Hits o0.5", col: "hits" as const, line: 0.5, oppRate: (t: { kRate: number; hRate: number }) => t.hRate, lg: lgHRate },
  ];

  for (const P of PROPS) {
    const base = batting.reduce((a, r) => a + (r[P.col]! > P.line ? 1 : 0), 0) / batting.length;
    interface Row { hit: number; proj: number; oppRel: number; date: Date }
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
      const hit = b.hits === null ? 0 : b[P.col]! > P.line ? 1 : 0;
      const oppSeries = b.opposingStarterId ? series.get(b.opposingStarterId) : undefined;
      const opp = oppSeries ? pitcherTrailing(oppSeries, b.gameDate) : null;
      const oppRel = opp ? P.oppRate(opp) - P.lg : 0;

      if (seasonSample > 0) {
        const recentRate = recent.length ? recent.reduce((a, x) => a + x, 0) / recent.length : null;
        const proj = projectPropHit({ seasonHits, seasonSample, recentRate, baseRate: base });
        if (proj) rows.push({ hit, proj: proj.probability, oppRel, date: b.gameDate });
      }
      seasonHits += hit;
      seasonSample += 1;
      recent.push(hit);
      if (recent.length > 10) recent.shift();
    }

    // Tercile residual by opposing-pitcher rate.
    const withOpp = rows.filter((r) => r.oppRel !== 0).sort((a, b) => a.oppRel - b.oppRel);
    const t = Math.floor(withOpp.length / 3);
    const buckets = [withOpp.slice(0, t), withOpp.slice(t, 2 * t), withOpp.slice(2 * t)];
    const gaps = buckets.map((bk) => (bk.reduce((a, r) => a + (r.hit - r.proj), 0) / bk.length) * 100);

    // OOS opponent term: fit beta on older 70%, judge Brier on newer 30%.
    const sorted = [...withOpp].sort((a, b) => a.date.getTime() - b.date.getTime());
    const cut = Math.floor(sorted.length * 0.7);
    const train = sorted.slice(0, cut);
    const val = sorted.slice(cut);
    let sxy = 0;
    let sxx = 0;
    for (const r of train) {
      sxy += r.oppRel * (r.hit - r.proj);
      sxx += r.oppRel * r.oppRel;
    }
    const beta = sxx > 0 ? sxy / sxx : 0;
    const clamp = (p: number) => Math.min(Math.max(p, 0.02), 0.98);
    const brier = (fn: (r: Row) => number) => val.reduce((a, r) => a + (fn(r) - r.hit) ** 2, 0) / val.length;
    const bd = brier((r) => r.proj);
    const ba = brier((r) => clamp(r.proj + beta * r.oppRel));
    // All-data beta for the production constant.
    let axy = 0;
    let axx = 0;
    for (const r of withOpp) {
      axy += r.oppRel * (r.hit - r.proj);
      axx += r.oppRel * r.oppRel;
    }
    const betaAll = axx > 0 ? axy / axx : 0;

    console.log(`── ${P.label}  (n ${withOpp.length}, base ${(base * 100).toFixed(1)}%) ${"─".repeat(20)}`);
    console.log(
      `  residual by opposing-pitcher rate:  soft ${gaps[0].toFixed(1)}   avg ${gaps[1].toFixed(1)}   tough ${gaps[2].toFixed(1)}   spread ${(gaps[2] - gaps[0]).toFixed(1)}pt`
    );
    console.log(`  OOS opponent term:  beta ${beta.toFixed(2)}   val Brier ${bd.toFixed(4)} → ${ba.toFixed(4)}  (${ba < bd ? "IMPROVES" : "no gain"})`);
    console.log(`  all-data beta (for wiring): ${betaAll.toFixed(4)}\n`);
  }
  console.log("A nonzero spread + Brier improvement = the opposing starter is real batter-prop signal worth wiring, like opponent-K for pitchers.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
