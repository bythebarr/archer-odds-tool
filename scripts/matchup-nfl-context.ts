import { fetchNflGames } from "@/lib/nfl/games";
import { collectWalkForwardSamples, fitHomeFieldPoints, type WalkForwardSample } from "@/lib/nfl/srs/backtestHarness";

/**
 * Investigate-before-wire study for NFL game-line matchup context beyond the
 * base SRS ratings: weather, rest advantage, schedule spot (weekday), division
 * familiarity, and strength-of-schedule differential. Same bar as MLB's
 * `matchup-weather-props.ts`/`matchup-bullpen-props.ts`: regress the model's
 * own walk-forward OOS residual on each candidate, fit on the older 70%,
 * check the fitted effect actually holds up (residual reduction, monotone
 * bucket gradient) on the newer 30% before it's worth wiring as a real shift
 * in `model.ts`/`ratings.ts`. Every candidate below is checked against BOTH
 * margin and total residuals rather than a single assumed target, since which
 * one (if either) a given signal actually moves is exactly the open question.
 *
 * Uses the SAME walk-forward replay `backtest-nfl-srs.ts` uses
 * (`srs/backtestHarness.ts`) — this is an add-on study on top of that
 * baseline, not a second, drifting reimplementation.
 *
 * Run: `npm run matchup:nfl:context`
 */

const TRAIN_FRACTION = 0.7;
const MIN_GAMES = 8;
const START_SEASON = 2007;

function mean(xs: readonly number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
function stdev(xs: readonly number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
/** Simple OLS slope of y on x: cov(x,y)/var(x). */
function fitBeta(xs: readonly number[], ys: readonly number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  const cov = mean(xs.map((x, i) => (x - mx) * (ys[i] - my)));
  const varX = mean(xs.map((x) => (x - mx) ** 2));
  return varX === 0 ? 0 : cov / varX;
}
/** Residual variance reduction (fraction) when subtracting beta*x from y, i.e. does fitting help at all. */
function varianceReduction(xs: readonly number[], ys: readonly number[], beta: number): number {
  const baseVar = stdev(ys) ** 2;
  const residAfter = ys.map((y, i) => y - beta * xs[i]);
  const afterVar = stdev(residAfter) ** 2;
  return baseVar === 0 ? 0 : 1 - afterVar / baseVar;
}

function tercileReport(label: string, xs: readonly number[], residuals: readonly number[]) {
  const sorted = [...xs].sort((a, b) => a - b);
  const t1 = sorted[Math.floor(sorted.length / 3)];
  const t2 = sorted[Math.floor((2 * sorted.length) / 3)];
  const lo: number[] = [];
  const mid: number[] = [];
  const hi: number[] = [];
  xs.forEach((x, i) => {
    if (x <= t1) lo.push(residuals[i]);
    else if (x <= t2) mid.push(residuals[i]);
    else hi.push(residuals[i]);
  });
  console.log(
    `  ${label}: n=${xs.length}  low(n=${lo.length}) ${mean(lo).toFixed(2)}   mid(n=${mid.length}) ${mean(mid).toFixed(2)}   high(n=${hi.length}) ${mean(hi).toFixed(2)}`
  );
}

async function main() {
  console.log("Loading nflverse games.csv…");
  const all = await fetchNflGames();
  const reg = all
    .filter((g) => g.gameType === "REG" && g.result !== null && g.homeScore !== null && g.awayScore !== null)
    .filter((g) => g.season >= START_SEASON)
    .sort((x, y) => x.date.getTime() - y.date.getTime());

  const fittedHfa = fitHomeFieldPoints(reg.slice(0, Math.floor(reg.length * TRAIN_FRACTION)));
  const samples: WalkForwardSample[] = collectWalkForwardSamples(all, {
    startSeason: START_SEASON,
    minGames: MIN_GAMES,
    homeFieldPoints: fittedHfa,
  });
  const splitIdx = Math.floor(samples.length * TRAIN_FRACTION);
  const train = samples.slice(0, splitIdx);
  const validate = samples.slice(splitIdx);
  console.log(`${samples.length} graded samples — train ${train.length}, validate ${validate.length}.\n`);

  const marginResidual = (s: WalkForwardSample) => s.actualMargin - s.pred.projectedMargin;
  const totalResidual = (s: WalkForwardSample) => s.actualTotal - s.pred.projectedTotal;

  function investigate(name: string, signalOf: (s: WalkForwardSample) => number | null, target: "margin" | "total") {
    console.log(`── ${name} (target: ${target}) ──────────────────`);
    const trainPairs = train.map((s) => [signalOf(s), target === "margin" ? marginResidual(s) : totalResidual(s)] as const).filter(
      (p): p is [number, number] => p[0] !== null
    );
    const validatePairs = validate
      .map((s) => [signalOf(s), target === "margin" ? marginResidual(s) : totalResidual(s)] as const)
      .filter((p): p is [number, number] => p[0] !== null);
    if (trainPairs.length < 30 || validatePairs.length < 30) {
      console.log(`  insufficient data (train n=${trainPairs.length}, validate n=${validatePairs.length})\n`);
      return;
    }
    const trainX = trainPairs.map((p) => p[0]);
    const trainY = trainPairs.map((p) => p[1]);
    const beta = fitBeta(trainX, trainY);
    const trainVarReduction = varianceReduction(trainX, trainY, beta);

    const validateX = validatePairs.map((p) => p[0]);
    const validateY = validatePairs.map((p) => p[1]);
    const oosVarReduction = varianceReduction(validateX, validateY, beta);

    console.log(`  fitted beta (train) = ${beta.toFixed(4)}   train residual-variance reduction = ${(trainVarReduction * 100).toFixed(2)}%`);
    console.log(`  OOS residual-variance reduction (validate, same beta) = ${(oosVarReduction * 100).toFixed(2)}%`);
    tercileReport("validate residual by signal tercile", validateX, validateY);
    console.log();
  }

  // ---- 1. Weather: temp (outdoor only), target = total ----
  investigate(
    "Temperature (°F, outdoors only)",
    (s) => (s.roof === "outdoors" && s.temp !== null ? s.temp : null),
    "total"
  );
  // ---- 2. Weather: wind speed (outdoor only, no direction data in nflverse), target = total ----
  investigate("Wind speed (mph, outdoors only)", (s) => (s.roof === "outdoors" && s.wind !== null ? s.wind : null), "total");

  // ---- 3. Rest advantage: home rest - away rest, target = margin ----
  investigate(
    "Rest advantage (home days rest − away days rest)",
    (s) => (s.homeRest !== null && s.awayRest !== null ? s.homeRest - s.awayRest : null),
    "margin"
  );

  // ---- 4. Strength-of-schedule differential, target = margin ----
  investigate(
    "Strength-of-schedule differential (home SOS − away SOS)",
    (s) => s.homeRating.strengthOfSchedule - s.awayRating.strengthOfSchedule,
    "margin"
  );

  // ---- 5. Schedule spot: weekday, categorical — mean residual by day, both targets ----
  console.log("── Schedule spot (weekday) — validate-window mean residual by day ──────────────────");
  const byWeekday = new Map<string, { margin: number[]; total: number[] }>();
  for (const s of validate) {
    const bucket = byWeekday.get(s.weekday) ?? { margin: [], total: [] };
    bucket.margin.push(marginResidual(s));
    bucket.total.push(totalResidual(s));
    byWeekday.set(s.weekday, bucket);
  }
  for (const [day, { margin, total }] of [...byWeekday.entries()].sort((a, b) => b[1].margin.length - a[1].margin.length)) {
    console.log(
      `  ${day.padEnd(10)} n=${String(margin.length).padStart(4)}  margin resid mean ${mean(margin).toFixed(2)}   total resid mean ${mean(total).toFixed(2)}`
    );
  }
  console.log();

  // ---- 6. Division familiarity — validate-window mean |margin| and total, div vs non-div ----
  console.log("── Division familiarity — validate-window actuals, div_game vs not ──────────────────");
  const div = validate.filter((s) => s.divGame);
  const nonDiv = validate.filter((s) => !s.divGame);
  console.log(
    `  div_game=true  n=${div.length}   mean |actual margin| ${mean(div.map((s) => Math.abs(s.actualMargin))).toFixed(2)}   mean total ${mean(div.map((s) => s.actualTotal)).toFixed(2)}`
  );
  console.log(
    `  div_game=false n=${nonDiv.length}   mean |actual margin| ${mean(nonDiv.map((s) => Math.abs(s.actualMargin))).toFixed(2)}   mean total ${mean(nonDiv.map((s) => s.actualTotal)).toFixed(2)}`
  );
  console.log(
    `  (residual, not raw actuals, is the fairer comparison since the model may already price this in — also checking)`
  );
  console.log(
    `  div_game=true  mean margin resid ${mean(div.map(marginResidual)).toFixed(2)}   mean total resid ${mean(div.map(totalResidual)).toFixed(2)}`
  );
  console.log(
    `  div_game=false mean margin resid ${mean(nonDiv.map(marginResidual)).toFixed(2)}   mean total resid ${mean(nonDiv.map(totalResidual)).toFixed(2)}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
