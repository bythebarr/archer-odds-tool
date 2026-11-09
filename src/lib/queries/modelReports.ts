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
  /** When the lab ran this grading (the report row's stamp). */
  runAt: Date;
  /**
   * The newest date in the graded sample itself (Decision 10) — the DATA
   * date, distinct from runAt. Null for reports saved before backtests
   * recorded it. A card whose runAt advances weekly while dataAsOf stands
   * still is being re-printed from a frozen sample, and now says so.
   */
  dataAsOf: string | null;
  /** Samples gained since the previous run of this model (n − previous n); null on a model's first card. 0 = the sample did not grow. */
  deltaN: number | null;
  /** The previous run's Brier, for the trend. */
  previousBrier: number | null;
}

/**
 * The latest report card per model, with the run before it for a trend.
 *
 * Latest-per-model via `distinct`, NOT a global take: the old take: 500
 * silently dropped any model that stopped being written once ~9 weeks of
 * other models' runs pushed its last card out of the window — the exact
 * failure this page exists to make visible (Lane-2 D6). A stopped model
 * now stays on the page, aging in plain sight.
 */
export async function getModelCards(): Promise<ModelCard[]> {
  const orderBy = [{ model: "asc" as const }, { createdAt: "desc" as const }];
  const latest = await prisma.modelReport.findMany({ distinct: ["model"], orderBy });
  if (latest.length === 0) return [];
  const previous = await prisma.modelReport.findMany({
    where: { id: { notIn: latest.map((r) => r.id) } },
    distinct: ["model"],
    orderBy,
  });
  const prevByModel = new Map(previous.map((r) => [r.model, r]));
  return latest.map((row) => {
    const prev = prevByModel.get(row.model);
    const detail = row.detail as { buckets?: ReliabilityBucket[]; refit?: RefitResult };
    const extra = (row.extra ?? {}) as {
      projectionMae?: number;
      baselineMae?: number;
      baseline?: string;
      noLinesMae?: number;
      modelWeight?: number;
      modelLogLoss?: number;
      marketLogLoss?: number;
      blendLogLoss?: number;
      sampleDataAsOf?: unknown;
    };
    return {
      model: row.model,
      label: row.label,
      unit: row.unit,
      n: row.n,
      brier: row.brier,
      baseRateBrier: row.baseRateBrier,
      meanPred: row.meanPred,
      actual: row.actual,
      verdict: row.verdict,
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
      runAt: row.createdAt,
      dataAsOf: typeof extra.sampleDataAsOf === "string" ? extra.sampleDataAsOf : null,
      deltaN: prev ? row.n - prev.n : null,
      previousBrier: prev?.brier ?? null,
    };
  });
}
