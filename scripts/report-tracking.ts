import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { loadGradedLeans } from "@/lib/queries/edgeReport";
import { groupTrackingLeans, TRACKING_SOURCE } from "@/lib/tracking/bridge";
import { formatCalibrationReport, scoreCalibration } from "@/lib/engine/calibration";
import { saveReport, SAVING } from "@/lib/engine/saveReport";

/**
 * The tracking -> ModelReport bridge, run by the Model lab: forward
 * tracking's graded leans (frozen before each game, graded after -- the same
 * population /models/edges reads) become public report cards under their own
 * `tracking:` model keys, labeled as forward-tracking evidence and never
 * pooled with the backtest sample. See lib/tracking/bridge.ts for the
 * honesty rules.
 *
 * Like the other lab scripts this only writes ModelReport rows, and only
 * when SAVE_REPORT=1 (the workflow sets it). Verdicts use scoreCalibration's
 * default thresholds -- the same bar as every other card; the bridge fits no
 * weights and prices nothing.
 *
 * Run: `npm run report:tracking`
 */

/** loadGradedLeans windows are in days; the bridge grades the full forward record. */
const ALL_TIME_DAYS = 36_500;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const signedPct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

async function main() {
  const leans = await loadGradedLeans(ALL_TIME_DAYS);
  const specs = groupTrackingLeans(leans);
  console.log(`\nForward tracking: ${leans.length} settled leans loaded, ${specs.length} report groups.`);
  if (!SAVING) console.log("(SAVE_REPORT is not set -- printing only, no cards written.)");
  for (const spec of specs) {
    const report = scoreCalibration(spec.samples);
    console.log(formatCalibrationReport(spec.label, spec.unit, report));
    const seg = spec.segment;
    console.log(
      `  tracker read: ROI ${signedPct(seg.roi)} at captured prices (95% range ${signedPct(seg.roiLow)} to ${signedPct(seg.roiHigh)})` +
        (seg.clv !== null
          ? `; CLV ${seg.clv >= 0 ? "+" : ""}${(seg.clv * 100).toFixed(2)} pts over ${seg.clvN} closes; beat the close ${seg.beatClose !== null ? pct(seg.beatClose) : "-"}`
          : "; no closing quotes yet") +
        (spec.altN > 0 ? `; includes ${spec.altN} alternate-line leans` : "") +
        (spec.pushes + spec.voids > 0 ? `; ${spec.pushes} pushes / ${spec.voids} voids excluded` : "")
    );
    await saveReport(spec.modelKey, spec.label, spec.unit, report, {
      source: TRACKING_SOURCE,
      roi: seg.roi,
      roiLow: seg.roiLow,
      roiHigh: seg.roiHigh,
      clv: seg.clv,
      clvN: seg.clvN,
      beatClose: seg.beatClose,
      ...(spec.altN > 0 ? { altLineN: spec.altN } : {}),
    });
  }
  if (specs.length === 0) console.log("No graded tracking leans yet -- no cards written (absent, not zeros).");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
