import { fetchNflGames } from "@/lib/nfl/games";
import { collectWalkForwardSamples, fitHomeFieldPoints, type WalkForwardSample } from "@/lib/nfl/srs/backtestHarness";

/**
 * NFL SRS model — fit + honest CLV backtest, in one script (Phase B of the SRS
 * model plan). Two things happen here, in order:
 *
 * 1. **Fit** `HOME_FIELD_POINTS`/`MARGIN_SD`/`TOTAL_SD` against real nflverse
 *    history — walk-forward, fit on the older 70% of a recent window, the
 *    project's own established convention (see e.g. winProbability.ts's
 *    STRENGTH_CALIBRATION_SHRINK, projection.ts's PRIOR_STRENGTH_GAMES). Unlike
 *    CFB (no real market data to fit against at all), NFL has real historical
 *    closing lines in the same file, so these are genuinely fit, not guessed.
 * 2. **Backtest**, on the newer 30% (out-of-sample), using the SAME ATS-edge-
 *    bucket + moneyline-banded-EV + flat-favorite-baseline harness shape as
 *    `scripts/backtest-nfl-clv.ts` (which ran this exact test against the
 *    existing Elo model and found it CLV-negative: -3.38% to -7.97% ROI). This
 *    is the actual acceptance gate for the SRS model — beat (or come close to)
 *    the closing line, or it doesn't get wired into `nflAdapter`, full stop.
 *
 * Walk-forward sample collection itself lives in `srs/backtestHarness.ts`,
 * shared with `scripts/matchup-nfl-context.ts` so both scripts replay the
 * exact same lookahead-safe pass rather than two implementations drifting
 * apart.
 *
 * Run: `npm run backtest:nfl:srs` (optionally `START_SEASON=2007`).
 */

const ATS_EDGE = 1.0;
const DECIMAL_110 = 1 + 100 / 110;
const MIN_EV = 0.02;
const MAX_EV = 0.2;
const ML_START_SEASON = 2019; // nflverse closing moneylines begin here
const TRAIN_FRACTION = 0.7;
const MIN_GAMES = 8; // same "seen" threshold as backtest-nfl-clv.ts's Elo backtest — direct comparability
const START_SEASON = process.env.START_SEASON ? parseInt(process.env.START_SEASON, 10) : 2007;

function amToDec(american: number): number {
  return american > 0 ? american / 100 + 1 : 100 / Math.abs(american) + 1;
}
function mean(xs: readonly number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
function stdev(xs: readonly number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
function brier(probs: readonly number[], outcomes: readonly number[]): number {
  return mean(probs.map((p, i) => (p - outcomes[i]) ** 2));
}
function normalCdf(x: number, sd: number): number {
  const z = x / (sd * Math.SQRT2);
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y =
    1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  const erf = z >= 0 ? y : -y;
  return 0.5 * (1 + erf);
}

interface Tally {
  bets: number;
  staked: number;
  pnl: number;
  wins: number;
  pushes: number;
}
const newTally = (): Tally => ({ bets: 0, staked: 0, pnl: 0, wins: 0, pushes: 0 });
function settle(t: Tally, outcome: 0 | 0.5 | 1, odds: number) {
  t.bets++;
  t.staked += 1;
  if (outcome === 1) {
    t.pnl += odds - 1;
    t.wins++;
  } else if (outcome === 0.5) {
    t.pushes++;
  } else {
    t.pnl -= 1;
  }
}
function report(name: string, t: Tally) {
  if (!t.bets) {
    console.log(`${name.padEnd(12)} — no qualifying bets`);
    return;
  }
  const roi = (t.pnl / t.staked) * 100;
  const decided = t.bets - t.pushes;
  const winPct = decided > 0 ? (t.wins / decided) * 100 : 0;
  console.log(
    `${name.padEnd(12)} bets ${String(t.bets).padStart(5)}  win ${winPct.toFixed(1)}%  push ${String(t.pushes).padStart(4)}  ` +
      `P/L ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(1)}u  ROI ${roi >= 0 ? "+" : ""}${roi.toFixed(2)}%`
  );
}

async function main() {
  console.log("Loading nflverse games.csv (free: results + closing lines)…");
  const all = await fetchNflGames();

  const reg = all
    .filter((g) => g.gameType === "REG" && g.result !== null && g.homeScore !== null && g.awayScore !== null)
    .filter((g) => g.season >= START_SEASON)
    .sort((x, y) => x.date.getTime() - y.date.getTime());
  console.log(`${reg.length} regular-season games, seasons ${START_SEASON}+.\n`);

  const trainSplitIdxRaw = Math.floor(reg.length * TRAIN_FRACTION);
  const fittedHfa = fitHomeFieldPoints(reg.slice(0, trainSplitIdxRaw));
  console.log(`Fitted HOME_FIELD_POINTS = ${fittedHfa.toFixed(3)} (mean home margin, non-neutral, train window)\n`);

  const samples: WalkForwardSample[] = collectWalkForwardSamples(all, {
    startSeason: START_SEASON,
    minGames: MIN_GAMES,
    homeFieldPoints: fittedHfa,
  });
  console.log(`${samples.length} graded samples (≥${MIN_GAMES} games' history both sides).\n`);

  const splitIdx = Math.floor(samples.length * TRAIN_FRACTION);
  const trainSamples = samples.slice(0, splitIdx);
  const validateSamples = samples.slice(splitIdx);

  const marginResiduals = trainSamples.map((s) => s.actualMargin - s.pred.projectedMargin);
  const totalResiduals = trainSamples.map((s) => s.actualTotal - s.pred.projectedTotal);
  const fittedMarginSd = stdev(marginResiduals);
  const fittedTotalSd = stdev(totalResiduals);
  console.log(`Fitted MARGIN_SD = ${fittedMarginSd.toFixed(2)}  (train residual stdev, n=${trainSamples.length})`);
  console.log(`Fitted TOTAL_SD  = ${fittedTotalSd.toFixed(2)}  (train residual stdev, n=${trainSamples.length})\n`);

  function winProbWithFittedSd(margin: number): number {
    return normalCdf(margin, fittedMarginSd);
  }
  const nonTieValidate = validateSamples.filter((s) => s.actualMargin !== 0);
  const oosProbs = nonTieValidate.map((s) => winProbWithFittedSd(s.pred.projectedMargin));
  const oosOutcomes = nonTieValidate.map((s) => (s.actualMargin > 0 ? 1 : 0));
  const oosBrier = brier(oosProbs, oosOutcomes);
  const baseRate = mean(oosOutcomes);
  const baseRateBrier = brier(
    oosOutcomes.map(() => baseRate),
    oosOutcomes
  );
  console.log(`=== OOS calibration (validate window, n=${nonTieValidate.length}) ===`);
  console.log(
    `SRS Brier: ${oosBrier.toFixed(4)}   base-rate-guess Brier: ${baseRateBrier.toFixed(4)}   home base rate: ${(baseRate * 100).toFixed(1)}%\n`
  );

  const atsWindow = newTally();
  const atsFlatFav = newTally();
  const atsBuckets = [
    { lo: 1, hi: 2, t: newTally() },
    { lo: 2, hi: 3, t: newTally() },
    { lo: 3, hi: 5, t: newTally() },
    { lo: 5, hi: 99, t: newTally() },
  ];
  const mlBanded = newTally();
  const mlFlatFav = newTally();

  for (const s of validateSamples) {
    if (s.spreadLine !== null) {
      const edge = s.pred.projectedMargin - s.spreadLine; // nflverse convention: positive spreadLine = home favored
      if (Math.abs(edge) >= ATS_EDGE) {
        const betHome = edge > 0;
        const outcome: 0 | 0.5 | 1 =
          s.actualMargin === s.spreadLine ? 0.5 : betHome === s.actualMargin > s.spreadLine ? 1 : 0;
        settle(atsWindow, outcome, DECIMAL_110);
        const bk = atsBuckets.find((b) => Math.abs(edge) >= b.lo && Math.abs(edge) < b.hi);
        if (bk) settle(bk.t, outcome, DECIMAL_110);
      }
      if (s.spreadLine !== 0) {
        const favHome = s.spreadLine > 0;
        const favOutcome: 0 | 0.5 | 1 =
          s.actualMargin === s.spreadLine ? 0.5 : favHome === s.actualMargin > s.spreadLine ? 1 : 0;
        settle(atsFlatFav, favOutcome, DECIMAL_110);
      }
    }

    if (s.season >= ML_START_SEASON && s.homeMoneyline !== null && s.awayMoneyline !== null) {
      const pHome = winProbWithFittedSd(s.pred.projectedMargin);
      const decHome = amToDec(s.homeMoneyline);
      const decAway = amToDec(s.awayMoneyline);
      const evHome = pHome * decHome - 1;
      const evAway = (1 - pHome) * decAway - 1;
      const betHome = evHome >= evAway;
      const ev = betHome ? evHome : evAway;
      const odds = betHome ? decHome : decAway;
      const homeWon = s.actualMargin > 0;
      if (ev >= MIN_EV && ev <= MAX_EV) {
        settle(mlBanded, betHome === homeWon ? 1 : 0, odds);
      }
      const favHome = decHome <= decAway;
      settle(mlFlatFav, favHome === homeWon ? 1 : 0, favHome ? decHome : decAway);
    }
  }

  console.log(`=== ATS: SRS model vs close, |edge| ≥ ${ATS_EDGE}pt, graded at −110 (validate window) ===`);
  report("model ATS", atsWindow);
  report("flat-fav", atsFlatFav);
  console.log("\n=== ATS ROI by model-vs-market edge bucket (monotone up = real signal) ===");
  for (const b of atsBuckets) report(`${b.lo}-${b.hi === 99 ? "∞" : b.hi}pt`, b.t);

  console.log(`\n=== Moneyline: SRS model +EV picks [${MIN_EV * 100}%,${MAX_EV * 100}%] into the close (validate window, 2019+) ===`);
  report("model ML", mlBanded);
  report("flat-fav", mlFlatFav);

  console.log(
    "\nCompare against the existing Elo model's own backtest (npm run backtest:nfl:clv): " +
      "ATS -3.38% to -6.80%, ML -7.97% ROI. This model only gets wired into nflAdapter if it clears that bar."
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
