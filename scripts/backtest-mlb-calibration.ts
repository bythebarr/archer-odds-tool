import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { mlbAdapter } from "@/lib/engine/adapters/mlb";
import { scoreCalibration, formatCalibrationReport } from "@/lib/engine/calibration";

/**
 * Lookahead-safe calibration backtest for the Archer MLB win-probability
 * (moneyline) model. Commits the reconstruction that winProbability.ts's docstring
 * describes but that was never checked in — so the baked STRENGTH_CALIBRATION_SHRINK
 * (0.2) is reproducible from now on. The sport-specific as-of rebuild lives on the
 * adapter's `model.backtest.collect`; this just scores it through the shared harness.
 *
 * Run: `npm run backtest:mlb` (optionally `N=2000 npm run backtest:mlb`).
 * Expect a thin edge at best — the docstring's audit found the calibrated model
 * roughly at the home base rate. Calibration keeps it HONEST; it is not the edge.
 */
async function main() {
  const limit = Number(process.env.N ?? 2000);
  const backtest = mlbAdapter.model?.backtest;
  if (!backtest) throw new Error("MLB model has no backtest");

  console.log(`Backtesting Archer MLB win-probability over up to ${limit} recent final games…`);
  const samples = await backtest.collect({ limit });
  const report = scoreCalibration(samples);
  console.log("\n" + formatCalibrationReport("Archer MLB moneyline", backtest.unit, report));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
