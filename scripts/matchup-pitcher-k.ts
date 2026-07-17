import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { projectPropHit } from "@/lib/props/projection";
import { buildTeamKRateModel, opponentTrailingKRate } from "@/lib/props/opponentKRate";

/**
 * Does the OPPONENT lineup explain the pitcher-strikeout edge?
 *
 * The de-biased edge screen left pitcher Ks as the one pitching market with a
 * real residual edge — but the projection is pitcher-ONLY (his own K rate + the
 * workload ramp). Strikeouts are a two-sided event: a pitcher fans more batters
 * against a whiff-prone lineup than a contact one. If the opposing team's own
 * strikeout tendency explains the residual the pitcher-only model leaves, that's
 * free matchup signal a base-anchored book may not fully price — a deeper edge.
 *
 * Lookahead-safe throughout: each team's batter-K rate uses only its games
 * BEFORE the start being predicted; the pitcher projection uses only prior starts.
 *
 * Run: `npm run matchup:pitcherk`.
 */

const RAMP: Record<string, { slope: number; pivot: number; cap: number }> = {
  "4.5": { slope: 0.01766, pivot: 5.0, cap: 8 },
  "5.5": { slope: 0.01457, pivot: 5.14, cap: 8 },
  "6.5": { slope: 0.01407, pivot: 5.31, cap: 8 },
};
const LINES = [4.5, 5.5, 6.5];
const HOLD = 0.06;

async function main() {
  console.log("Loading batting logs to build team K-rate series…");
  const batting = await prisma.playerGameLog.findMany({
    where: { plateAppearances: { not: null } },
    select: { teamId: true, gameDate: true, strikeoutsBatting: true, plateAppearances: true },
  });
  const teamModel = buildTeamKRateModel(batting);
  const leagueRate = teamModel.leagueRate;
  console.log(`League batter-K rate: ${(leagueRate * 100).toFixed(1)}% per PA.\n`);

  console.log("Loading starts + games to derive opponents…");
  const starts = await prisma.playerGameLog.findMany({
    where: { isStarter: true },
    select: {
      mlbPlayerId: true,
      gameDate: true,
      strikeoutsPitching: true,
      teamId: true,
      isHome: true,
      game: { select: { homeTeamId: true, awayTeamId: true } },
    },
    orderBy: [{ mlbPlayerId: "asc" }, { gameDate: "asc" }],
  });

  // Base rate per line (over all qualified starts), for the projection prior.
  const baseByLine = new Map<number, number>();
  for (const line of LINES) {
    const vals = starts.filter((s) => s.strikeoutsPitching !== null);
    baseByLine.set(line, vals.reduce((a, s) => a + (s.strikeoutsPitching! > line ? 1 : 0), 0) / vals.length);
  }

  interface Row {
    hit: number;
    proj: number;
    oppRel: number; // opponent trailing K-rate minus league (signed), or 0 if unknown
    date: Date;
  }
  const perLine = new Map<number, Row[]>();
  for (const line of LINES) perLine.set(line, []);

  // Walk each pitcher's starts season-by-season to project lookahead-safe.
  let curPlayer = "";
  let curYear = -1;
  let seasonHits: Record<number, number> = {};
  let seasonSample = 0;
  let recent: Record<number, number[]> = {};
  for (const s of starts) {
    if (s.strikeoutsPitching === null) continue;
    const year = s.gameDate.getUTCFullYear();
    if (s.mlbPlayerId !== curPlayer || year !== curYear) {
      curPlayer = s.mlbPlayerId;
      curYear = year;
      seasonHits = {};
      seasonSample = 0;
      recent = {};
      for (const line of LINES) {
        seasonHits[line] = 0;
        recent[line] = [];
      }
    }

    const oppTeamId = s.isHome ? s.game?.awayTeamId : s.game?.homeTeamId;
    const oppRate = opponentTrailingKRate(teamModel, oppTeamId, s.gameDate);
    const oppRel = oppRate === null ? 0 : oppRate - leagueRate;

    if (seasonSample > 0) {
      for (const line of LINES) {
        const rr = recent[line];
        const recentRate = rr.length ? rr.reduce((a, b) => a + b, 0) / rr.length : null;
        const proj = projectPropHit(
          { seasonHits: seasonHits[line], seasonSample, recentRate, baseRate: baseByLine.get(line)! },
          { ramp: RAMP[String(line)] }
        );
        if (proj) perLine.get(line)!.push({ hit: s.strikeoutsPitching > line ? 1 : 0, proj: proj.probability, oppRel, date: s.gameDate });
      }
    }
    for (const line of LINES) {
      const h = s.strikeoutsPitching > line ? 1 : 0;
      seasonHits[line] += h;
      recent[line].push(h);
      if (recent[line].length > 10) recent[line].shift();
    }
    seasonSample += 1;
  }

  // ── (1) Is opponent K-rate related to the residual? ──────────────────────
  console.log("(1) Pitcher-K residual (actual−proj, pts) by opponent K-rate tercile:");
  console.log("line".padEnd(8) + "soft (low-K opp)".padStart(18) + "average".padStart(12) + "whiff-prone opp".padStart(18) + "spread".padStart(10));
  for (const line of LINES) {
    const rows = perLine.get(line)!.filter((r) => r.oppRel !== 0);
    const sorted = [...rows].sort((a, b) => a.oppRel - b.oppRel);
    const t = Math.floor(sorted.length / 3);
    const buckets = [sorted.slice(0, t), sorted.slice(t, 2 * t), sorted.slice(2 * t)];
    const gaps = buckets.map((b) => (b.reduce((a, r) => a + (r.hit - r.proj), 0) / b.length) * 100);
    const spread = gaps[2] - gaps[0];
    console.log(
      `o${line}`.padEnd(8) +
        `${gaps[0] >= 0 ? "+" : ""}${gaps[0].toFixed(1)}`.padStart(18) +
        `${gaps[1] >= 0 ? "+" : ""}${gaps[1].toFixed(1)}`.padStart(12) +
        `${gaps[2] >= 0 ? "+" : ""}${gaps[2].toFixed(1)}`.padStart(18) +
        `${spread >= 0 ? "+" : ""}${spread.toFixed(1)}`.padStart(10)
    );
  }
  console.log("(a positive spread = pitchers beat their projection MORE vs whiff-prone lineups → real matchup signal)");

  // ── (2) Fit an opponent coefficient (train) & validate OOS ───────────────
  // Model: adjusted prob = proj + beta * oppRel. Fit beta by OLS of residual on
  // oppRel over the older 70%; judge Brier + f=1 ROI on the newer 30%.
  console.log("\n(2) Opponent term — fit on train, out-of-sample validation:");
  console.log("line".padEnd(8) + "beta".padStart(9) + "val Brier →".padStart(22) + "val f=1 ROI →".padStart(24));
  for (const line of LINES) {
    const rows = perLine.get(line)!.filter((r) => r.oppRel !== 0).sort((a, b) => a.date.getTime() - b.date.getTime());
    const cut = Math.floor(rows.length * 0.7);
    const train = rows.slice(0, cut);
    const val = rows.slice(cut);
    // OLS through: residual ≈ beta * oppRel (no intercept — proj already centered).
    let sxy = 0;
    let sxx = 0;
    for (const r of train) {
      sxy += r.oppRel * (r.hit - r.proj);
      sxx += r.oppRel * r.oppRel;
    }
    const beta = sxx > 0 ? sxy / sxx : 0;
    const clamp = (p: number) => Math.min(Math.max(p, 0.02), 0.98);
    const brier = (fn: (r: Row) => number) => val.reduce((a, r) => a + (fn(r) - r.hit) ** 2, 0) / val.length;
    const roiF1 = (fn: (r: Row) => number) => {
      const base = baseByLine.get(line)!;
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
    const bd = brier((r) => r.proj);
    const ba = brier((r) => clamp(r.proj + beta * r.oppRel));
    const rd = roiF1((r) => r.proj);
    const ra = roiF1((r) => clamp(r.proj + beta * r.oppRel));
    console.log(
      `o${line}`.padEnd(8) +
        beta.toFixed(2).padStart(9) +
        `${bd.toFixed(4)} → ${ba.toFixed(4)}`.padStart(22) +
        `${rd >= 0 ? "+" : ""}${rd.toFixed(1)}% → ${ra >= 0 ? "+" : ""}${ra.toFixed(1)}%`.padStart(24)
    );
  }
  console.log(`\n(f=1 floor for an edgeless prop = ${((-HOLD / (1 + HOLD)) * 100).toFixed(1)}%. Rising ROI + falling Brier = the opponent term adds real edge.)`);

  // ── (3) Production coefficients: refit beta on ALL rows per line ─────────
  console.log("\n(3) Opponent betas refit on ALL rows — paste into lib/props/opponentKRate.ts:");
  for (const line of LINES) {
    const rows = perLine.get(line)!.filter((r) => r.oppRel !== 0);
    let sxy = 0;
    let sxx = 0;
    for (const r of rows) {
      sxy += r.oppRel * (r.hit - r.proj);
      sxx += r.oppRel * r.oppRel;
    }
    const beta = sxx > 0 ? sxy / sxx : 0;
    console.log(`  "${line}": ${beta.toFixed(4)},`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
