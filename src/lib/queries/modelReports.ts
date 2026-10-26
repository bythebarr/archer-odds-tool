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
  /** Projection error without the game-lines layer, when the backtest measured it. */
  noLinesMae: number | null;
  /** Market-blend fits: the model's fitted weight and each side's log loss. */
  market: { modelWeight: number; modelLogLoss: number; marketLogLoss: number; blendLogLoss: number } | null;
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
    const extra = (latest.extra ?? {}) as {
      projectionMae?: number;
      baselineMae?: number;
      baseline?: string;
      noLinesMae?: number;
      modelWeight?: number;
      modelLogLoss?: number;
      marketLogLoss?: number;
      blendLogLoss?: number;
    };
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
      noLinesMae: extra.noLinesMae ?? null,
      market:
        extra.modelWeight !== undefined && extra.modelLogLoss !== undefined && extra.marketLogLoss !== undefined && extra.blendLogLoss !== undefined
          ? { modelWeight: extra.modelWeight, modelLogLoss: extra.modelLogLoss, marketLogLoss: extra.marketLogLoss, blendLogLoss: extra.blendLogLoss }
          : null,
      runAt: latest.createdAt,
      previousBrier: previous?.brier ?? null,
    };
  });
}
