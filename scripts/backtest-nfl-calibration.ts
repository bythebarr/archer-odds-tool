import { collectNflSamples } from "@/lib/nfl/model";
import { scoreCalibration, formatCalibrationReport } from "@/lib/engine/calibration";

/**
 * Lookahead-safe calibration backtest for the NFL Elo model — same shared harness,
 * same report shape as MLB/UFC/tennis. Answers "are the model's win probabilities
 * HONEST" (does its 62% win 62%), which is separate from "does it beat the close"
 * (that's `npm run backtest:nfl:clv`). Both run entirely on free nflverse data.
 *
 * Run: `npm run backtest:nfl` (optionally `N=8000 npm run backtest:nfl`).
 */
async function main() {
  const limit = Number(process.env.N ?? 6000);
  console.log(`Backtesting NFL Elo over up to ${limit} recent games (free nflverse)…`);
  const samples = await collectNflSamples({ limit });
  const report = scoreCalibration(samples);
  console.log("\n" + formatCalibrationReport("NFL Elo", "game", report));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
