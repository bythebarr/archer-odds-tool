import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { SPORTS } from "@/lib/engine";
import { scoreCalibration, formatCalibrationReport } from "@/lib/engine/calibration";

/**
 * Run every registered model's calibration backtest through the shared harness
 * and print one report card per sport, then a summary table of verdicts. This is
 * the trust dashboard: it's how you see, at a glance, which models have earned the
 * right to price the paid card and which are still coin-flips. A new sport's model
 * shows up here automatically the moment its adapter declares a `model.backtest` —
 * no wiring per sport (sport-engine Phase 4a).
 *
 * Run: `npm run backtest:all` (optionally `N=1500 npm run backtest:all`).
 */
async function main() {
  const limit = Number(process.env.N ?? 1500);
  const modeled = SPORTS.filter((s) => s.model?.backtest);

  console.log(`Calibration backtest for ${modeled.length} modeled sport(s), up to ${limit} events each…`);

  const summary: { sport: string; verdict: string; brier: number; base: number; n: number }[] = [];
  for (const adapter of modeled) {
    const backtest = adapter.model!.backtest!;
    try {
      const samples = await backtest.collect({ limit });
      const report = scoreCalibration(samples);
      console.log("\n" + formatCalibrationReport(adapter.meta.label, backtest.unit, report));
      summary.push({
        sport: adapter.meta.label,
        verdict: report.verdict,
        brier: report.brier,
        base: report.baseRateBrier,
        n: report.n,
      });
    } catch (err) {
      console.error(`\n${adapter.meta.label}: backtest failed —`, (err as Error).message);
      summary.push({ sport: adapter.meta.label, verdict: "error", brier: NaN, base: NaN, n: 0 });
    }
  }

  console.log(`\n=== trust summary ===`);
  console.log(`sport         verdict       n      Brier   base    skill`);
  for (const s of summary) {
    const skill = (s.brier - s.base).toFixed(4);
    console.log(
      s.sport.padEnd(13) +
        s.verdict.padEnd(13) +
        String(s.n).padStart(5) +
        `   ${s.brier.toFixed(4)}  ${s.base.toFixed(4)}  ${s.brier <= s.base ? "" : "+"}${skill}`
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
