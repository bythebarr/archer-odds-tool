/**
 * The edge tracker's data: every settled lean (lib/tracking) in a window,
 * scored by lib/tracking/evaluate. Cached: the settle job writes a few times
 * a day, and the page reads the whole window.
 */
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { TRACKED_MODELS, type GradedLean, type LeanFeatures, type SettleResult } from "@/lib/tracking/types";
import { evaluateLeans } from "@/lib/tracking/evaluate";

export const EDGE_WINDOWS = { "30": 30, "90": 90, season: 240 } as const;
export type EdgeWindow = keyof typeof EDGE_WINDOWS;

export async function loadGradedLeans(days: number, now = new Date()): Promise<GradedLean[]> {
  const rows = await prisma.predictionSettlement.findMany({
    where: { prediction: { scheduledStartUtc: { gte: new Date(now.getTime() - days * 86_400_000) }, run: { modelKey: { in: Object.values(TRACKED_MODELS) } } } },
    select: { result: true, closingProb: true, prediction: { select: { probability: true, featureSnapshot: true, scheduledStartUtc: true } } },
  });
  return rows.flatMap((r) =>
    r.prediction.probability === null
      ? []
      : [
          {
            features: r.prediction.featureSnapshot as unknown as LeanFeatures,
            prob: r.prediction.probability,
            result: r.result as SettleResult,
            closingProb: r.closingProb,
            startsAt: r.prediction.scheduledStartUtc,
          },
        ]
  );
}

export const getEdgeReport = unstable_cache(
  async (window: EdgeWindow) => {
    const leans = await loadGradedLeans(EDGE_WINDOWS[window]);
    const pending = await prisma.modelPrediction.count({ where: { settlement: null, run: { modelKey: { in: Object.values(TRACKED_MODELS) } } } });
    const first = leans.reduce<Date | null>((a, l) => (!a || l.startsAt < a ? l.startsAt : a), null);
    return { ...evaluateLeans(leans), pending, since: first?.toISOString() ?? null };
  },
  ["edge-report"],
  { revalidate: 1800 }
);
