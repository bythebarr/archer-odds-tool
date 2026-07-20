import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { projectPropHit } from "@/lib/props/projection";

/**
 * Does the OPPOSING BATTERY explain stolen-base residuals (SB o0.5)?
 *
 * SB is the best-discriminating batting prop on the edge screen, and the most
 * matchup-dependent event in the game: a runner steals far more against a
 * weak-throwing catcher / slow-to-the-plate staff than a good one. The batting
 * projection is runner-ONLY (his own trailing SB rate), blind to who he's running
 * on. This asks whether the opposing team's trailing SB-allowed rate predicts the
 * residual the runner-only projection leaves — the SB analog of opponent-K.
 *
 * "SB allowed by team T" = stolen bases by the batters who FACED T, per opponent
 * plate appearance, trailing-only (lookahead-safe). Team-level (not catcher-level,
 * which we don't log per game) — a proxy for the whole battery's running-game
 * control.
 *
 * Confound honesty: a team that allows steals is often just worse pitching → more
 * baserunners → more SB opportunity, which partly overlaps a plate-appearance /
 * on-base effect the runner-only rate already sees. So this reports, per tercile,
 * the runner's mean PA — if high-SB-allowed games just hand the runner more PA,
 * the "edge" is opportunity, not a battery signal. Same discipline as platoon/park.
 *
 * Run: `npm run matchup:sb`.
 */

const MIN_OPP_PA = 800; // a team's SB-allowed rate needs a stable sample of faced PA

interface TeamDay {
  date: Date;
  sbAllowed: number; // steals BY the opponent's batters this game
  paFaced: number; // opponent plate appearances this game
}

/** A defense team's trailing SB-allowed per faced-PA from games strictly before `date`. */
function teamSbAllowedRate(series: TeamDay[] | undefined, date: Date): number | null {
  if (!series) return null;
  let sb = 0;
  let pa = 0;
  for (const g of series) {
    if (g.date >= date) break;
    sb += g.sbAllowed;
    pa += g.paFaced;
  }
  return pa >= MIN_OPP_PA ? sb / pa : null;
}

async function main() {
  console.log("Loading batting logs…");
  const batting = await prisma.playerGameLog.findMany({
    where: { plateAppearances: { not: null } },
    select: {
      mlbPlayerId: true,
      gameDate: true,
      stolenBases: true,
      plateAppearances: true,
      isHome: true,
      teamId: true,
      game: { select: { homeTeamId: true, awayTeamId: true } },
    },
    orderBy: [{ mlbPlayerId: "asc" }, { gameDate: "asc" }],
  });

  // Build each DEFENSE team's SB-allowed series: for every batter row, the steal
  // is charged to the team the batter faced (the opponent), per (defenseTeam, day).
  const byDay = new Map<string, TeamDay & { team: string }>();
  let lgSB = 0;
  let lgPA = 0;
  for (const b of batting) {
    if (b.plateAppearances === null || !b.game) continue;
    const defenseTeam = b.isHome ? b.game.awayTeamId : b.game.homeTeamId; // who the batter ran on
    if (!defenseTeam) continue;
    const sb = b.stolenBases ?? 0;
    lgSB += sb;
    lgPA += b.plateAppearances;
    const key = `${defenseTeam}|${b.gameDate.toISOString().slice(0, 10)}`;
    const cur = byDay.get(key) ?? { team: defenseTeam, date: b.gameDate, sbAllowed: 0, paFaced: 0 };
    cur.sbAllowed += sb;
    cur.paFaced += b.plateAppearances;
    byDay.set(key, cur);
  }
  const series = new Map<string, TeamDay[]>();
  for (const g of byDay.values()) {
    const arr = series.get(g.team) ?? [];
    arr.push(g);
    series.set(g.team, arr);
  }
  for (const arr of series.values()) arr.sort((a, b) => a.date.getTime() - b.date.getTime());
  const lgRate = lgSB / lgPA;
  console.log(`League SB-allowed: ${(lgRate * 1000).toFixed(1)} per 1000 PA · ${series.size} defenses.\n`);

  const LINE = 0.5;
  const base = batting.reduce((a, r) => a + ((r.stolenBases ?? 0) > LINE ? 1 : 0), 0) / batting.length;
  interface Row { hit: number; proj: number; oppRel: number; pa: number; date: Date }
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
    const hit = (b.stolenBases ?? 0) > LINE ? 1 : 0;
    const defenseTeam = b.isHome ? b.game?.awayTeamId : b.game?.homeTeamId;
    const oppRate = teamSbAllowedRate(defenseTeam ? series.get(defenseTeam) : undefined, b.gameDate);
    const oppRel = oppRate === null ? 0 : oppRate - lgRate;

    if (seasonSample > 0) {
      const recentRate = recent.length ? recent.reduce((a, x) => a + x, 0) / recent.length : null;
      const proj = projectPropHit({ seasonHits, seasonSample, recentRate, baseRate: base });
      if (proj) rows.push({ hit, proj: proj.probability, oppRel, pa: b.plateAppearances ?? 0, date: b.gameDate });
    }
    seasonHits += hit;
    seasonSample += 1;
    recent.push(hit);
    if (recent.length > 10) recent.shift();
  }

  const withOpp = rows.filter((r) => r.oppRel !== 0).sort((a, b) => a.oppRel - b.oppRel);
  const t = Math.floor(withOpp.length / 3);
  const buckets = [withOpp.slice(0, t), withOpp.slice(t, 2 * t), withOpp.slice(2 * t)];
  const gaps = buckets.map((bk) => (bk.reduce((a, r) => a + (r.hit - r.proj), 0) / bk.length) * 100);
  const paLo = buckets[0].reduce((a, r) => a + r.pa, 0) / buckets[0].length;
  const paHi = buckets[2].reduce((a, r) => a + r.pa, 0) / buckets[2].length;

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
  let axy = 0;
  let axx = 0;
  for (const r of withOpp) {
    axy += r.oppRel * (r.hit - r.proj);
    axx += r.oppRel * r.oppRel;
  }
  const betaAll = axx > 0 ? axy / axx : 0;

  console.log(`── Stolen Bases o0.5  (n ${withOpp.length}, base ${(base * 100).toFixed(1)}%) ${"─".repeat(18)}`);
  console.log(
    `  residual by opp SB-allowed:  stingy ${gaps[0].toFixed(1)}   avg ${gaps[1].toFixed(1)}   leaky ${gaps[2].toFixed(1)}   spread ${(gaps[2] - gaps[0]).toFixed(1)}pt`
  );
  console.log(`  PA-confound probe:  stingy-D ${paLo.toFixed(2)} PA/g vs leaky-D ${paHi.toFixed(2)} PA/g  (Δ ${(paHi - paLo).toFixed(2)})`);
  console.log(`  OOS opp term:  beta ${beta.toFixed(2)}   val Brier ${bd.toFixed(4)} → ${ba.toFixed(4)}  (${ba < bd ? "IMPROVES" : "no gain"})`);
  console.log(`  all-data beta (for wiring): ${betaAll.toFixed(4)}\n`);
  console.log("Spread + Brier improvement + a small PA gap = a real battery signal worth wiring.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
