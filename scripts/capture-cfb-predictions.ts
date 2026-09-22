import "dotenv/config";
import { captureCfbPredictions } from "@/lib/cfb/capturePredictions";
import { CFB_MODEL_KEY, CFB_MODEL_VERSION, CFB_MODEL_LIFECYCLE } from "@/lib/cfb/modelIdentity";
import { PredictionValidationError } from "@/lib/predictions";
import { parseArgs, safeErrorMessage, summarizeExclusions } from "./captureCfbArgs";

/**
 * Manual forward-capture for CFB v0's experimental prediction model. See
 * docs/architecture/MODEL-PREDICTION-LIFECYCLE.md and CFB-V0.md's
 * "Forward-prediction capture" for the full design. Deliberately NOT a cron
 * route yet — this is the first, manual step.
 *
 * Usage:
 *   npm run capture:cfb:predictions
 *   npm run capture:cfb:predictions -- --date=2026-09-27
 *   npm run capture:cfb:predictions -- --date=2026-09-27 --confirm-rerun
 *
 * Uses only the free, unkeyed ESPN CFB scoreboard and this project's
 * configured DATABASE_URL — no paid provider, no new API key. Pure argument
 * parsing/formatting/error-sanitizing helpers live in `captureCfbArgs.ts`
 * (unit-tested there); this file is the thin process-lifecycle entry point.
 */
async function main() {
  const { dateEt, confirmRerun } = parseArgs(process.argv.slice(2));

  console.log(`CFB prediction capture — ${CFB_MODEL_KEY} ${CFB_MODEL_VERSION} (${CFB_MODEL_LIFECYCLE})`);
  console.log(`Date (ET): ${dateEt}`);

  const result = await captureCfbPredictions(dateEt, { confirmRerun });

  if (result.blockedByExistingRun) {
    console.error(
      `A CFB prediction run already exists for ${dateEt} (${CFB_MODEL_KEY} ${CFB_MODEL_VERSION}): ` +
        `run ${result.blockedByExistingRun.id}, generated at ${result.blockedByExistingRun.generatedAt.toISOString()}.`
    );
    console.error("Re-run with --confirm-rerun to capture again as a new, additional revision.");
    process.exitCode = 1;
    return;
  }

  console.log(`Eligible games: ${result.capture.eligibleGameCount}`);
  console.log("Exclusions by reason:");
  console.log(summarizeExclusions(result.capture.exclusions));

  if (!result.capture.runInput || !result.written) {
    console.log(`Nothing eligible for ${dateEt} — no PredictionRun written. This is a truthful empty result, not an error.`);
    return;
  }

  // `await captureCfbPredictions` above already resolved the write's own
  // transaction (see createPredictionRun) before this line can run — nothing
  // below can print "written" ahead of the commit actually completing.
  console.log(`generatedAt: ${result.capture.runInput.generatedAt.toISOString()}`);
  console.log(`dataAsOfUtc: ${result.capture.runInput.dataAsOfUtc.toISOString()}`);
  console.log(`Run ID: ${result.written.runId}`);
  console.log(`Rows written: ${result.written.predictionIds.length}`);
}

main()
  .catch((err) => {
    if (err instanceof PredictionValidationError) {
      console.error(`Validation failed: ${err.issues.join("; ")}`);
    } else {
      console.error(`CFB prediction capture failed: ${safeErrorMessage(err)}`);
    }
    process.exitCode = 1;
  })
  .finally(() => process.exit());
