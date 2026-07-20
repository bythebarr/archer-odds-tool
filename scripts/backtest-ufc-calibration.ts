import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { ufcAdapter } from "@/lib/engine/adapters/ufc";
import { scoreCalibration, formatCalibrationReport } from "@/lib/engine/calibration";

/**
 * Lookahead-safe calibration backtest for the UFC fighter-math model. The
 * sport-specific part (rebuilding each bout's projection as-of, with no future
 * leakage) now lives on the adapter's `model.backtest.collect`; this script just
 * scores those samples through the shared engine harness and prints the report
 * card — the same Brier + reliability buckets + time-split shrink refit as before,
 * now identical in shape to every other sport's backtest.
 *
 * Run: `npm run backtest:ufc` (optionally `N=1200 npm run backtest:ufc`).
 * This model has only a thin per-fight edge; calibration keeps it HONEST, it does
 * not manufacture edge. See fighterMath.ts.
 */
async function main() {
  const limit = Number(process.env.N ?? 900);
  const backtest = ufcAdapter.model?.backtest;
  if (!backtest) throw new Error("UFC model has no backtest");

  console.log(`Backtesting UFC fighter-math calibration over up to ${limit} recent completed bouts…`);
  const samples = await backtest.collect({ limit });
  const report = scoreCalibration(samples);
  console.log("\n" + formatCalibrationReport("UFC fighter-math", backtest.unit, report));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
