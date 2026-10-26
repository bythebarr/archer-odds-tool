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
      ...(extra ? { extra: extra as Prisma.InputJsonValue } : {}),
    },
  });
}
