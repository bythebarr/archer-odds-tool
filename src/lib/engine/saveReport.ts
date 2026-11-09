/**
 * Saves a backtest report card for the /models page when the run asks for it
 * (SAVE_REPORT=1, which the Model lab workflow sets). Local runs print only.
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { CalibrationReport } from "./calibration";

export const SAVING = process.env.SAVE_REPORT === "1";

export async function saveReport(
  model: string,
  label: string,
  unit: string,
  report: CalibrationReport,
  extra?: Record<string, unknown>
): Promise<void> {
  if (!SAVING || report.n === 0) return;
  // The sample's data-as-of rides in extra so the /models card can show the
  // DATA date next to the run date (Decision 10) — a re-run over a frozen
  // population then visibly re-prints the same data date instead of
  // looking freshly graded. A caller's own key wins on collision.
  const mergedExtra = { ...(report.sampleDataAsOf ? { sampleDataAsOf: report.sampleDataAsOf } : {}), ...(extra ?? {}) };
  await prisma.modelReport.create({
    data: {
      model,
      label,
      unit,
      n: report.n,
      brier: report.brier,
      baseRateBrier: report.baseRateBrier,
      logLoss: report.logLoss,
      meanPred: report.meanPred,
      actual: report.actual,
      verdict: report.verdict,
      detail: { buckets: report.buckets, refit: report.refit } as unknown as Prisma.InputJsonValue,
      ...(Object.keys(mergedExtra).length > 0 ? { extra: mergedExtra as Prisma.InputJsonValue } : {}),
    },
  });
}
