import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { projectPropHit } from "@/lib/props/projection";
import { buildBullpenRunRateModel, trailingBullpenSplit, recentBullpenWorkload, RECENT_BULLPEN_WORKLOAD_GAMES } from "@/lib/archer/bullpenRate";

/**
 * Does the OPPOSING team's bullpen state explain batter-prop residuals
 * (hits / total bases / home runs)?
 *
 * This session built two bullpen signals for the game-line model
 * (expectedRuns.ts): season-long trailing quality (bullpenExpectedRunRate)
 * and recent-workload fatigue (bullpenFatiguePenalty). Neither has ever been
 * tested against player props — a batter facing a worse-than-average or
 * recently-overworked bullpen SHOULD see elevated HR/TB/hit probability if
 * the effect that moves team-level expected runs also shows up at the
 * individual plate-appearance level. This is genuinely untested territory
 * (unlike the shelved platoon/park/SB studies, which HAVE been run).
 *
 * Reuses archer/bullpenRate.ts's production functions unmodified — same
 * model, same league-average anchors (4.3 runs/game, 3.5 relief IP/game)
 * expectedRuns.ts already uses, so a passing result here is directly
 * consistent with what's already live in the game-line model, not a
 * competing re-derivation.
 *
 * PA-confound honesty (the trap that shelved the platoon signal): does the
 * BATTER's own team score more — and so bat around further, picking up
 * extra plate appearances — specifically because the OPPOSING bullpen is
 * bad or tired that day? Checked explicitly per signal, the same way
 * matchup-batter-park.ts checks its own park-PA hypothesis.
 *
 * Lookahead-safe throughout: both bullpen signals use only relief
 * appearances strictly BEFORE the game being projected; the batter
 * projection uses only his own prior games this season.
 *
 * PREREQUISITE: needs a real, multi-week+ historical archive of
 * PlayerGameLog rows (isStarter: false for the bullpen side) — this
 * sandbox's database has none. Run once real data exists.
 *
 * Run: `npm run matchup:bullpenprops`.
 */

const LEAGUE_AVG_RUNS_PER_GAME = 4.3; // same anchor as expectedRuns.ts
const LEAGUE_AVG_RELIEF_INNINGS_PER_GAME = 3.5; // same anchor as expectedRuns.ts

interface Row {
  hit: number;
  proj: number;
  qualityRel: number; // opposing bullpen trailing runs/9 minus league average (0 if unknown)
  fatigueRel: number; // opposing bullpen recent IP/game minus league-typical pace (0 if unknown)
  pa: number;
  date: Date;
}

function reportSignal(
  label: string,
  rows: Row[],
  signalOf: (r: Row) => number,
  base: number
): void {
  const withSignal = rows.filter((r) => signalOf(r) !== 0).sort((a, b) => signalOf(a) - signalOf(b));
  if (withSignal.length < 30) {
    console.log(`  ${label}: too few rows with a resolved signal (n=${withSignal.length}) — skipping.`);
    return;
  }
  const t = Math.floor(withSignal.length / 3);
  const buckets = [withSignal.slice(0, t), withSignal.slice(t, 2 * t), withSignal.slice(2 * t)];
  const gaps = buckets.map((bk) => (bk.reduce((a, r) => a + (r.hit - r.proj), 0) / bk.length) * 100);
  // PA-confound probe: mean PA in the "tough matchup" (high signal) vs "easy matchup" (low signal) tercile.
  const paLo = buckets[0].reduce((a, r) => a + r.pa, 0) / buckets[0].length;
  const paHi = buckets[2].reduce((a, r) => a + r.pa, 0) / buckets[2].length;

  // OOS term: fit beta on older 70%, judge Brier on newer 30%.
  const sorted = [...withSignal].sort((a, b) => a.date.getTime() - b.date.getTime());
  const cut = Math.floor(sorted.length * 0.7);
  const train = sorted.slice(0, cut);
  const val = sorted.slice(cut);
  let sxy = 0;
  let sxx = 0;
  for (const r of train) {
    sxy += signalOf(r) * (r.hit - r.proj);
    sxx += signalOf(r) * signalOf(r);
  }
  const beta = sxx > 0 ? sxy / sxx : 0;
  const clamp = (p: number) => Math.min(Math.max(p, 0.02), 0.98);
  const brier = (fn: (r: Row) => number) => val.reduce((a, r) => a + (fn(r) - r.hit) ** 2, 0) / val.length;
  const bd = brier((r) => r.proj);
  const ba = brier((r) => clamp(r.proj + beta * signalOf(r)));
  const HOLD = 0.06;
  const roiF1 = (fn: (r: Row) => number) => {
    let staked = 0;
    let pnl = 0;
    for (const r of val) {
      const p = fn(r);
      if (Math.abs(p - base) < 0.03) continue;
      const over = p - base > 0;
      const implied = over ? p : 1 - p;
      if (implied <= 0 || implied >= 1) continue;
      const dec = 1 / (implied * (1 + HOLD));
      const won = over ? r.hit === 1 : r.hit === 0;
      staked += 1;
      pnl += won ? dec - 1 : -1;
    }
    return staked ? (pnl / staked) * 100 : NaN;
  };
  const rd = roiF1((r) => r.proj);
  const ra = roiF1((r) => clamp(r.proj + beta * signalOf(r)));
  let axy = 0;
  let axx = 0;
  for (const r of withSignal) {
    axy += signalOf(r) * (r.hit - r.proj);
    axx += signalOf(r) * signalOf(r);
  }
  const betaAll = axx > 0 ? axy / axx : 0;

  console.log(`  ${label}  (n ${withSignal.length})`);
  console.log(
    `    residual by tercile:  low ${gaps[0].toFixed(1)}   mid ${gaps[1].toFixed(1)}   high ${gaps[2].toFixed(1)}   spread ${(gaps[2] - gaps[0]).toFixed(1)}pt`
  );
  console.log(`    PA-confound probe:  low ${paLo.toFixed(2)} PA/g vs high ${paHi.toFixed(2)} PA/g  (Δ ${(paHi - paLo).toFixed(2)})`);
  console.log(
    `    OOS: beta ${beta.toFixed(3)}   val Brier ${bd.toFixed(4)} → ${ba.toFixed(4)} (${ba < bd ? "IMPROVES" : "no gain"})   f=1 ROI ${rd >= 0 ? "+" : ""}${rd.toFixed(1)}% → ${ra >= 0 ? "+" : ""}${ra.toFixed(1)}%`
  );
  console.log(`    all-data beta (for wiring): ${betaAll.toFixed(4)}`);
}

async function main() {
  console.log("Loading relief-appearance logs to build the bullpen model…");
  const relief = await prisma.playerGameLog.findMany({
    where: { isStarter: false, outsRecorded: { gt: 0 }, earnedRuns: { not: null } },
    select: { teamId: true, gameDate: true, outsRecorded: true, earnedRuns: true },
  });
  const bullpenModel = buildBullpenRunRateModel(
    relief.map((r) => ({
      key: `${r.gameDate.getUTCFullYear()}:${r.teamId}`,
      gameDate: r.gameDate,
      outsRecorded: r.outsRecorded,
      earnedRuns: r.earnedRuns,
    }))
  );
  console.log(`Bullpen model built from ${relief.length} relief-appearance rows across ${bullpenModel.series.size} team-seasons.\n`);

  console.log("Loading batting logs…");
  const batting = await prisma.playerGameLog.findMany({
    where: { plateAppearances: { not: null } },
    select: {
      mlbPlayerId: true,
      gameDate: true,
      hits: true,
      totalBases: true,
      homeRuns: true,
      plateAppearances: true,
      isHome: true,
      game: { select: { homeTeamId: true, awayTeamId: true } },
    },
    orderBy: [{ mlbPlayerId: "asc" }, { gameDate: "asc" }],
  });
  if (batting.length === 0) {
    console.log("0 batting games found in the archive — nothing to study. Run this against a database with real historical PlayerGameLog data.");
    return;
  }

  const PROPS = [
    { label: "Hits o0.5", col: "hits" as const, line: 0.5 },
    { label: "Total Bases o1.5", col: "totalBases" as const, line: 1.5 },
    { label: "Home Runs o0.5", col: "homeRuns" as const, line: 0.5 },
  ];

  for (const P of PROPS) {
    const base = batting.reduce((a, r) => a + ((r[P.col] ?? 0) > P.line ? 1 : 0), 0) / batting.length;
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

      const oppTeamId = b.isHome ? b.game?.awayTeamId : b.game?.homeTeamId;
      const oppKey = oppTeamId ? `${year}:${oppTeamId}` : null;
      const quality = oppKey ? trailingBullpenSplit(bullpenModel, oppKey, b.gameDate) : null;
      const qualityRel = quality && quality.outsRecorded > 0 ? (27 * quality.earnedRuns) / quality.outsRecorded - LEAGUE_AVG_RUNS_PER_GAME : 0;
      const workload = oppKey ? recentBullpenWorkload(bullpenModel, oppKey, RECENT_BULLPEN_WORKLOAD_GAMES, b.gameDate) : null;
      const fatigueRel =
        workload && workload.games > 0 ? workload.outsRecorded / 3 / workload.games - LEAGUE_AVG_RELIEF_INNINGS_PER_GAME : 0;

      if (seasonSample > 0) {
        const recentRate = recent.length ? recent.reduce((a, x) => a + x, 0) / recent.length : null;
        const proj = projectPropHit({ seasonHits, seasonSample, recentRate, baseRate: base });
        if (proj) {
          rows.push({ hit, proj: proj.probability, qualityRel, fatigueRel, pa: b.plateAppearances ?? 0, date: b.gameDate });
        }
      }
      seasonHits += hit;
      seasonSample += 1;
      recent.push(hit);
      if (recent.length > 10) recent.shift();
    }

    console.log(`── ${P.label}  (n ${rows.length}, base ${(base * 100).toFixed(1)}%) ${"─".repeat(18)}`);
    reportSignal("Bullpen quality (worse opposing pen → higher over rate?)", rows, (r) => r.qualityRel, base);
    reportSignal("Bullpen fatigue (more-worked opposing pen → higher over rate?)", rows, (r) => r.fatigueRel, base);
    console.log("");
  }
  console.log("Spread + Brier improvement + a PA gap that's SMALL relative to the spread = a real signal worth wiring.");
  console.log(`(f=1 floor for an edgeless prop = ${((-0.06 / 1.06) * 100).toFixed(1)}%.)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
