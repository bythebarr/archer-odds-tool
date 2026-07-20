import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { tennisAdapter } from "@/lib/engine/adapters/tennis";
import { scoreCalibration, formatCalibrationReport } from "@/lib/engine/calibration";

/**
 * Lookahead-safe calibration backtest for the surface-aware tennis Elo model.
 * Replays the free Sackmann archive through the model (see the adapter's
 * model.backtest) and scores it via the shared harness — identical shape to
 * MLB/UFC. Tennis is a heavy-favorite sport, so this is the first model we expect
 * to show a real, trusted edge rather than a near-coin-flip.
 *
 * Run: `npm run backtest:tennis` (optionally `N=8000 npm run backtest:tennis`).
 */
async function main() {
  const limit = Number(process.env.N ?? 20000);
  const backtest = tennisAdapter.model?.backtest;
  if (!backtest) throw new Error("Tennis model has no backtest");

  console.log(`Backtesting surface-aware tennis Elo over up to ${limit} recent matches…`);
  const samples = await backtest.collect({ limit });
  const report = scoreCalibration(samples);
  console.log("\n" + formatCalibrationReport("Tennis Elo", backtest.unit, report));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
