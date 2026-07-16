import { collectSoccerSamples } from "@/lib/soccer/model";
import { scoreCalibration, formatCalibrationReport } from "@/lib/engine/calibration";

/**
 * Lookahead-safe calibration backtest for the soccer Poisson model — same shared
 * harness, same report shape as MLB/UFC/tennis/NFL. Answers "are the model's 3-way
 * probabilities HONEST" (does its 55% favorite win 55%), separate from "does it beat
 * the close" (`npm run backtest:soccer:clv`). Both run entirely on free
 * football-data.co.uk data.
 *
 * Run: `npm run backtest:soccer` (optionally `N=8000 npm run backtest:soccer`).
 */
async function main() {
  const limit = Number(process.env.N ?? 12000);
  console.log(`Backtesting soccer Poisson over up to ${limit} recent matches (free football-data)…`);
  const samples = await collectSoccerSamples({ limit });
  const report = scoreCalibration(samples);
  console.log("\n" + formatCalibrationReport("Soccer Poisson", "match", report));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
