import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { getTeamFormForGame } from "@/lib/queries/teamForm";
import { computeExpectedRuns } from "@/lib/archer/expectedRuns";
import { archerTotalOverProb, archerSpreadCoverProb } from "@/lib/archer/runProbability";
import { buildBullpenRunRateModel, trailingBullpenSplit, type BullpenRunRateModel } from "@/lib/archer/bullpenRate";
import { RECENT_STARTS_LONG_WINDOW, RECENT_STARTS_SHORT_WINDOW } from "@/lib/archer/pitcherRecency";
import { gradeGameLine } from "@/lib/discord/gradePlay";
import {
  scoreCalibration,
  formatCalibrationReport,
  DEFAULT_TRUST_MARGIN,
  type CalibrationSample,
} from "@/lib/engine/calibration";
import type { GameMatchup, PitcherInfo } from "@/lib/queries/matchup";

/**
 * Lookahead-safe totals/spread backtest for the Archer MLB expected-runs
 * model — the sibling scripts/backtest-mlb-calibration.ts never built,
 * because computeExpectedRuns has never been backtested at all (only the
 * moneyline model has). Built specifically to answer one question before
 * shipping team-specific bullpen quality (see docs/architecture/
 * MLB-MODEL-INVENTORY.md §8): does swapping the flat league-average bullpen
 * constant for each team's own trailing relief-pitching rate actually lower
 * out-of-sample Brier on totals and spreads, by at least DEFAULT_TRUST_MARGIN?
 *
 * Reconstructs each historical game's matchup exactly as it stood before
 * first pitch — same as-of pattern as collectMlbSamples in
 * engine/adapters/mlb.ts (preload starters once, filter by date per game) —
 * then runs that reconstruction TWICE per game: once with real bullpen
 * splits, once with bullpen forced null (today's pre-existing behavior), so
 * one run prints a direct before/after comparison instead of requiring two
 * separate invocations to be diffed by hand.
 *
 * Grades each side against the REAL closing line (GameClosingLine, already
 * populated by the existing grading pipeline — src/lib/grading/
 * gradeOutcomes.ts) via gradeGameLine, the same pure grader production
 * play-tracking already uses — no new grading logic invented here.
 *
 * Run: `npm run backtest:mlb:totals` (optionally `N=3000 npm run backtest:mlb:totals`).
 */

interface CollectedSamples {
  totals: CalibrationSample[];
  spreads: CalibrationSample[];
}

async function collectMlbTotalsSamples({
  limit,
  useBullpen,
}: {
  limit: number;
  useBullpen: boolean;
}): Promise<CollectedSamples> {
  const games = await prisma.game.findMany({
    where: {
      sport: "mlb",
      status: "final",
      homeScore: { not: null },
      awayScore: { not: null },
      homeTeamId: { not: null },
      awayTeamId: { not: null },
    },
    orderBy: { scheduledStartUtc: "desc" },
    take: limit,
    select: {
      id: true,
      season: true,
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
      scheduledStartUtc: true,
    },
  });
  if (!games.length) return { totals: [], spreads: [] };

  const seasons = [...new Set(games.map((g) => g.season))];

  // Preload every starter pitching line once — same pattern as
  // collectMlbSamples (engine/adapters/mlb.ts), duplicated rather than
  // shared (see docs/architecture/MLB-MODEL-INVENTORY.md §7's FeatureSnapshot
  // recommendation for the larger structural fix this doesn't attempt).
  const starterLogs = await prisma.playerGameLog.findMany({
    where: {
      isStarter: true,
      outsRecorded: { gt: 0 },
      earnedRuns: { not: null },
      game: { sport: "mlb", season: { in: seasons } },
    },
    select: {
      gameId: true,
      mlbPlayerId: true,
      teamId: true,
      gameDate: true,
      earnedRuns: true,
      outsRecorded: true,
      game: { select: { season: true } },
    },
  });

  const starterByGameTeam = new Map<string, Map<string, string>>();
  type Start = { date: Date; er: number; outs: number };
  const startsByPitcher = new Map<string, Start[]>();
  for (const r of starterLogs) {
    let byTeam = starterByGameTeam.get(r.gameId);
    if (!byTeam) starterByGameTeam.set(r.gameId, (byTeam = new Map()));
    byTeam.set(r.teamId, r.mlbPlayerId);
    const key = `${r.game.season}:${r.mlbPlayerId}`;
    const list = startsByPitcher.get(key) ?? [];
    list.push({ date: r.gameDate, er: r.earnedRuns ?? 0, outs: r.outsRecorded ?? 0 });
    startsByPitcher.set(key, list);
  }
  // Sort each pitcher's starts chronologically once — recency windows below
  // need ascending date order, which Prisma's return order doesn't guarantee.
  for (const list of startsByPitcher.values()) list.sort((a, b) => a.date.getTime() - b.date.getTime());

  const startSplitFrom = (starts: Start[]) => ({
    earnedRuns: starts.reduce((s, r) => s + r.er, 0),
    outsRecorded: starts.reduce((s, r) => s + r.outs, 0),
    starts: starts.length,
  });

  const asOfPitcher = (season: number, pitcherId: string | undefined, before: Date): PitcherInfo | null => {
    if (!pitcherId) return null;
    const prior = (startsByPitcher.get(`${season}:${pitcherId}`) ?? []).filter((s) => s.date < before);
    const outs = prior.reduce((s, r) => s + r.outs, 0);
    if (outs === 0) return null;
    const er = prior.reduce((s, r) => s + r.er, 0);
    return {
      fullName: "",
      wins: 0,
      losses: 0,
      era: (27 * er) / outs,
      gamesStarted: prior.length,
      inningsPitched: outs / 3,
      last10Starts: startSplitFrom(prior.slice(-RECENT_STARTS_LONG_WINDOW)),
      last5Starts: startSplitFrom(prior.slice(-RECENT_STARTS_SHORT_WINDOW)),
    };
  };

  // Preload relief logs the same way, keyed `${season}:${teamId}` so a
  // multi-season preload never blends unrelated years' bullpens together
  // (same trick startsByPitcher uses per-pitcher, above). Skipped entirely
  // for the baseline (useBullpen: false) pass — nothing reads it there.
  let bullpenModel: BullpenRunRateModel | null = null;
  if (useBullpen) {
    const reliefLogs = await prisma.playerGameLog.findMany({
      where: {
        isStarter: false,
        outsRecorded: { gt: 0 },
        earnedRuns: { not: null },
        game: { sport: "mlb", season: { in: seasons } },
      },
      select: {
        teamId: true,
        gameDate: true,
        outsRecorded: true,
        earnedRuns: true,
        game: { select: { season: true } },
      },
    });
    bullpenModel = buildBullpenRunRateModel(
      reliefLogs.map((r) => ({
        key: `${r.game.season}:${r.teamId}`,
        gameDate: r.gameDate,
        outsRecorded: r.outsRecorded,
        earnedRuns: r.earnedRuns,
      }))
    );
  }

  // Preload the real closing line for every game in view — the market point
  // to grade against and to feed archerTotalOverProb/archerSpreadCoverProb.
  // Totals only ever has a "over" row (gradeOutcomes.ts's captureClosingLine
  // is never called for totals/"under"); spreads has independent "home" and
  // "away" rows, each carrying that side's own point — never assumed mirrored.
  const closingLines = await prisma.gameClosingLine.findMany({
    where: { gameId: { in: games.map((g) => g.id) }, marketType: { in: ["totals", "spreads"] } },
    select: { gameId: true, marketType: true, side: true, point: true },
  });
  const closingByKey = new Map<string, number | null>();
  for (const cl of closingLines) {
    closingByKey.set(`${cl.gameId}:${cl.marketType}:${cl.side}`, cl.point);
  }

  const totalsSamples: CalibrationSample[] = [];
  const spreadsSamples: CalibrationSample[] = [];

  for (const g of games) {
    const before = g.scheduledStartUtc;
    const starters = starterByGameTeam.get(g.id);
    const { home: homeForm, away: awayForm } = await getTeamFormForGame(g.homeTeamId!, g.awayTeamId!, g.season, before);

    const homeBullpen =
      useBullpen && bullpenModel ? trailingBullpenSplit(bullpenModel, `${g.season}:${g.homeTeamId}`, before) : null;
    const awayBullpen =
      useBullpen && bullpenModel ? trailingBullpenSplit(bullpenModel, `${g.season}:${g.awayTeamId}`, before) : null;

    const matchup: GameMatchup = {
      homePitcher: asOfPitcher(g.season, starters?.get(g.homeTeamId!), before),
      awayPitcher: asOfPitcher(g.season, starters?.get(g.awayTeamId!), before),
      homeForm,
      awayForm,
      homeBullpen,
      awayBullpen,
    };

    const runs = computeExpectedRuns(matchup);
    if (runs.home === null || runs.away === null) continue; // too thin to price

    // Totals: model favorite (over/under), graded against the real closing total.
    const overPoint = closingByKey.get(`${g.id}:totals:over`);
    if (overPoint != null) {
      const overProb = archerTotalOverProb(overPoint, runs);
      if (overProb !== null) {
        const favSide = overProb >= 0.5 ? "over" : "under";
        const pred = favSide === "over" ? overProb : 1 - overProb;
        const result = gradeGameLine("totals", favSide, overPoint, g.homeScore!, g.awayScore!);
        if (result === "hit" || result === "miss") {
          totalsSamples.push({ pred, won: result === "hit" ? 1 : 0 });
        }
      }
    }

    // Spreads: each side graded against its OWN closing point (never inferred
    // as -otherSide's point). Model favorite is whichever side has the higher
    // cover probability when both points are known; falls back to whichever
    // one side actually has a closing line when only one does.
    const homePoint = closingByKey.get(`${g.id}:spreads:home`);
    const awayPoint = closingByKey.get(`${g.id}:spreads:away`);
    const homeCoverProb = homePoint != null ? archerSpreadCoverProb("home", homePoint, runs) : null;
    const awayCoverProb = awayPoint != null ? archerSpreadCoverProb("away", awayPoint, runs) : null;

    let pick: { side: "home" | "away"; point: number; prob: number } | null = null;
    if (homeCoverProb !== null && awayCoverProb !== null) {
      pick =
        homeCoverProb >= awayCoverProb
          ? { side: "home", point: homePoint!, prob: homeCoverProb }
          : { side: "away", point: awayPoint!, prob: awayCoverProb };
    } else if (homeCoverProb !== null) {
      pick = { side: "home", point: homePoint!, prob: homeCoverProb };
    } else if (awayCoverProb !== null) {
      pick = { side: "away", point: awayPoint!, prob: awayCoverProb };
    }

    if (pick) {
      const result = gradeGameLine("spreads", pick.side, pick.point, g.homeScore!, g.awayScore!);
      if (result === "hit" || result === "miss") {
        spreadsSamples.push({ pred: pick.prob, won: result === "hit" ? 1 : 0 });
      }
    }
  }

  return { totals: totalsSamples, spreads: spreadsSamples };
}

async function main() {
  const limit = Number(process.env.N ?? 2000);
  console.log(
    `Backtesting Archer MLB totals/spreads over up to ${limit} recent final games (flat-constant bullpen vs. team-specific bullpen quality)…`
  );

  const baseline = await collectMlbTotalsSamples({ limit, useBullpen: false });
  const bullpenAdjusted = await collectMlbTotalsSamples({ limit, useBullpen: true });

  const totalsBaseline = scoreCalibration(baseline.totals);
  const totalsBullpen = scoreCalibration(bullpenAdjusted.totals);
  const spreadsBaseline = scoreCalibration(baseline.spreads);
  const spreadsBullpen = scoreCalibration(bullpenAdjusted.spreads);

  console.log("\n" + formatCalibrationReport("Archer MLB totals — baseline (flat bullpen)", "total", totalsBaseline));
  console.log("\n" + formatCalibrationReport("Archer MLB totals — bullpen-adjusted", "total", totalsBullpen));
  console.log("\n" + formatCalibrationReport("Archer MLB spreads — baseline (flat bullpen)", "spread", spreadsBaseline));
  console.log("\n" + formatCalibrationReport("Archer MLB spreads — bullpen-adjusted", "spread", spreadsBullpen));

  const totalsDelta = totalsBaseline.brier - totalsBullpen.brier;
  const spreadsDelta = spreadsBaseline.brier - spreadsBullpen.brier;
  console.log(`\n=== Bullpen-quality acceptance gate (needs ≥ ${DEFAULT_TRUST_MARGIN} Brier improvement on each market) ===`);
  console.log(
    `Δ Brier totals:  ${totalsDelta >= 0 ? "+" : ""}${totalsDelta.toFixed(4)}  ${totalsDelta >= DEFAULT_TRUST_MARGIN ? "PASS" : "FAIL"}`
  );
  console.log(
    `Δ Brier spreads: ${spreadsDelta >= 0 ? "+" : ""}${spreadsDelta.toFixed(4)}  ${spreadsDelta >= DEFAULT_TRUST_MARGIN ? "PASS" : "FAIL"}`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
