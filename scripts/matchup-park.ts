import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { projectPropHit } from "@/lib/props/projection";
import {
  buildTeamKRateModel,
  opponentTrailingKRate,
  pitcherKContextShift,
} from "@/lib/props/opponentKRate";
import { buildParkKRateModel, parkTrailingKRate } from "@/lib/props/parkKRate";

/**
 * Does the BALLPARK explain any pitcher-strikeout edge left AFTER the opponent
 * matchup term?
 *
 * Opponent lineup (opponentKRate.ts) is already wired. The other big free
 * environmental factor a pitcher-only projection can't see is the park: some
 * yards suppress or inflate strikeouts (backdrop, foul territory, altitude).
 * This asks whether a park's own trailing strikeout environment predicts the
 * residual that the projection + opponent shift STILL leaves — i.e. whether
 * park is incremental signal or just a proxy for the opponent term we already
 * have.
 *
 * Confound honesty: a park's raw K/PA is contaminated by which staffs pitch
 * there. Two guards, same spirit as the platoon confound check:
 *   1. We regress the pitcher's RESIDUAL (actual − projection), so the pitcher's
 *      own skill is already removed — a park that only looks high-K because good
 *      arms pitch there won't move the residual.
 *   2. The baseline projection ALREADY carries the opponent shift, so a park
 *      that's really just "faces whiff-prone lineups" is controlled for too.
 * Whatever survives both is closer to a true environmental park effect.
 *
 * Lookahead-safe: park rate uses only games at that park strictly BEFORE the
 * start; opponent rate and the pitcher projection are trailing-only as well.
 *
 * Run: `npm run matchup:park`.
 */

const RAMP: Record<string, { slope: number; pivot: number; cap: number }> = {
  "4.5": { slope: 0.01766, pivot: 5.0, cap: 8 },
  "5.5": { slope: 0.01457, pivot: 5.14, cap: 8 },
  "6.5": { slope: 0.01407, pivot: 5.31, cap: 8 },
};
const LINES = [4.5, 5.5, 6.5];
const HOLD = 0.06;

async function main() {
  console.log("Loading batting logs (team K series + park K series)…");
  const batting = await prisma.playerGameLog.findMany({
    where: { plateAppearances: { not: null } },
    select: {
      teamId: true,
      gameDate: true,
      strikeoutsBatting: true,
      plateAppearances: true,
      game: { select: { homeTeamId: true } },
    },
  });
  const teamModel = buildTeamKRateModel(batting);
  const parkModel = buildParkKRateModel(batting.map((r) => ({
    park: r.game?.homeTeamId,
    gameDate: r.gameDate,
    strikeoutsBatting: r.strikeoutsBatting,
    plateAppearances: r.plateAppearances,
  })));
  const leagueRate = teamModel.leagueRate;
  console.log(`League batter-K rate: ${(leagueRate * 100).toFixed(1)}% per PA · ${parkModel.series.size} parks.\n`);

  console.log("Loading starts + games…");
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

  const baseByLine = new Map<number, number>();
  for (const line of LINES) {
    const vals = starts.filter((s) => s.strikeoutsPitching !== null);
    baseByLine.set(line, vals.reduce((a, s) => a + (s.strikeoutsPitching! > line ? 1 : 0), 0) / vals.length);
  }

  interface Row {
    hit: number;
    proj: number; // projection INCLUDING the wired opponent shift (the honest baseline)
    parkRel: number; // park trailing K/PA minus league, or 0 if unknown
    date: Date;
  }
  const perLine = new Map<number, Row[]>();
  for (const line of LINES) perLine.set(line, []);

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
    const parkRate = parkTrailingKRate(parkModel, s.game?.homeTeamId, s.gameDate);
    const parkRel = parkRate === null ? 0 : parkRate - leagueRate;

    if (seasonSample > 0) {
      for (const line of LINES) {
        const rr = recent[line];
        const recentRate = rr.length ? rr.reduce((a, b) => a + b, 0) / rr.length : null;
        // Baseline = the production projection: ramp + wired opponent contextShift.
        const proj = projectPropHit(
          { seasonHits: seasonHits[line], seasonSample, recentRate, baseRate: baseByLine.get(line)! },
          { ramp: RAMP[String(line)], contextShift: pitcherKContextShift(line, oppRate, leagueRate) }
        );
        if (proj) perLine.get(line)!.push({ hit: s.strikeoutsPitching > line ? 1 : 0, proj: proj.probability, parkRel, date: s.gameDate });
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

  // ── (1) Is park K-rate related to the residual the opponent term leaves? ──
  console.log("(1) Pitcher-K residual (actual−proj_with_opp, pts) by PARK K-rate tercile:");
  console.log("line".padEnd(8) + "low-K park".padStart(16) + "average".padStart(12) + "high-K park".padStart(16) + "spread".padStart(10));
  for (const line of LINES) {
    const rows = perLine.get(line)!.filter((r) => r.parkRel !== 0);
    const sorted = [...rows].sort((a, b) => a.parkRel - b.parkRel);
    const t = Math.floor(sorted.length / 3);
    const buckets = [sorted.slice(0, t), sorted.slice(t, 2 * t), sorted.slice(2 * t)];
    const gaps = buckets.map((b) => (b.reduce((a, r) => a + (r.hit - r.proj), 0) / b.length) * 100);
    const spread = gaps[2] - gaps[0];
    console.log(
      `o${line}`.padEnd(8) +
        `${gaps[0] >= 0 ? "+" : ""}${gaps[0].toFixed(1)}`.padStart(16) +
        `${gaps[1] >= 0 ? "+" : ""}${gaps[1].toFixed(1)}`.padStart(12) +
        `${gaps[2] >= 0 ? "+" : ""}${gaps[2].toFixed(1)}`.padStart(16) +
        `${spread >= 0 ? "+" : ""}${spread.toFixed(1)}`.padStart(10)
    );
  }
  console.log("(positive spread = pitchers beat the opp-adjusted projection MORE in high-K parks → incremental park signal)");

  // ── (2) Fit a park term (train) & validate OOS on top of proj+opp ────────
  console.log("\n(2) Park term — fit on older 70%, out-of-sample validation on newer 30%:");
  console.log("line".padEnd(8) + "beta".padStart(9) + "val Brier →".padStart(24) + "val f=1 ROI →".padStart(24));
  for (const line of LINES) {
    const rows = perLine.get(line)!.filter((r) => r.parkRel !== 0).sort((a, b) => a.date.getTime() - b.date.getTime());
    const cut = Math.floor(rows.length * 0.7);
    const train = rows.slice(0, cut);
    const val = rows.slice(cut);
    let sxy = 0;
    let sxx = 0;
    for (const r of train) {
      sxy += r.parkRel * (r.hit - r.proj);
      sxx += r.parkRel * r.parkRel;
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
    const ba = brier((r) => clamp(r.proj + beta * r.parkRel));
    const rd = roiF1((r) => r.proj);
    const ra = roiF1((r) => clamp(r.proj + beta * r.parkRel));
    console.log(
      `o${line}`.padEnd(8) +
        beta.toFixed(2).padStart(9) +
        `${bd.toFixed(4)} → ${ba.toFixed(4)}`.padStart(24) +
        `${rd >= 0 ? "+" : ""}${rd.toFixed(1)}% → ${ra >= 0 ? "+" : ""}${ra.toFixed(1)}%`.padStart(24)
    );
  }
  console.log(`\n(f=1 floor for an edgeless prop = ${((-HOLD / (1 + HOLD)) * 100).toFixed(1)}%. Falling Brier + rising ROI = park adds real edge ON TOP of the opponent term.)`);

  // ── (3) Production coefficients: refit beta on ALL rows per line ─────────
  console.log("\n(3) Park betas refit on ALL rows (only wire if section 2 validated):");
  for (const line of LINES) {
    const rows = perLine.get(line)!.filter((r) => r.parkRel !== 0);
    let sxy = 0;
    let sxx = 0;
    for (const r of rows) {
      sxy += r.parkRel * (r.hit - r.proj);
      sxx += r.parkRel * r.parkRel;
    }
    const beta = sxx > 0 ? sxy / sxx : 0;
    console.log(`  "${line}": ${beta.toFixed(4)},  (n=${rows.length})`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
