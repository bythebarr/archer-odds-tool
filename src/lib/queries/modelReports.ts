import { prisma } from "@/lib/prisma";
import type { ReliabilityBucket, RefitResult } from "@/lib/engine/calibration";

export interface ModelCard {
  model: string;
  label: string;
  unit: string;
  n: number;
  brier: number;
  baseRateBrier: number;
  meanPred: number;
  actual: number;
  verdict: string;
  buckets: ReliabilityBucket[];
  refit: RefitResult | null;
  projectionMae: number | null;
  baselineMae: number | null;
  baseline: string | null;
  runAt: Date;
  /** The previous run's Brier, for the trend. */
  previousBrier: number | null;
}

/** The latest report card per model, with the run before it for a trend. */
export async function getModelCards(): Promise<ModelCard[]> {
  const rows = await prisma.modelReport.findMany({ orderBy: [{ model: "asc" }, { createdAt: "desc" }], take: 500 });
  const byModel = new Map<string, typeof rows>();
  for (const r of rows) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r]);
  return [...byModel.values()].map(([latest, previous]) => {
    const detail = latest.detail as { buckets?: ReliabilityBucket[]; refit?: RefitResult };
    const extra = (latest.extra ?? {}) as { projectionMae?: number; baselineMae?: number; baseline?: string };
    return {
      model: latest.model,
      label: latest.label,
      unit: latest.unit,
      n: latest.n,
      brier: latest.brier,
      baseRateBrier: latest.baseRateBrier,
      meanPred: latest.meanPred,
      actual: latest.actual,
      verdict: latest.verdict,
      buckets: detail.buckets ?? [],
      refit: detail.refit ?? null,
      projectionMae: extra.projectionMae ?? null,
      baselineMae: extra.baselineMae ?? null,
      baseline: extra.baseline ?? null,
      runAt: latest.createdAt,
      previousBrier: previous?.brier ?? null,
    };
  });
}
