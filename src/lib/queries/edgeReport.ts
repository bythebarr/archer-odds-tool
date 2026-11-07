/**
 * The edge tracker's data: every settled lean (lib/tracking) in a window,
 * scored by lib/tracking/evaluate. Cached: the settle job writes a few times
 * a day, and the page reads the whole window.
 */
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { KNOWN_LEAN_SCHEMAS, TRACKED_MODELS, type GradedLean, type LeanFeatures, type SettleResult } from "@/lib/tracking/types";
import { evaluateLeans } from "@/lib/tracking/evaluate";
import { applyCorrections } from "@/lib/tracking/corrections";

export const EDGE_WINDOWS = { "30": 30, "90": 90, season: 240 } as const;
export type EdgeWindow = keyof typeof EDGE_WINDOWS;

export async function loadGradedLeans(days: number, now = new Date()): Promise<GradedLean[]> {
  const rows = await prisma.predictionSettlement.findMany({
    where: { prediction: { scheduledStartUtc: { gte: new Date(now.getTime() - days * 86_400_000) }, run: { modelKey: { in: Object.values(TRACKED_MODELS) } } } },
    select: {
      predictionId: true,
      result: true,
      actual: true,
      closingProb: true,
      closingPrice: true,
      prediction: { select: { probability: true, featureSnapshot: true, scheduledStartUtc: true, run: { select: { featureSchemaVersion: true } } } },
    },
  });
  // Grades are write-once history; corrections (append-only, lib/tracking/
  // corrections) supersede them. Resolve the effective grade per lean so a
  // corrected grade is what evaluation reads — the base row never changes.
  const corrections = rows.length
    ? await prisma.settlementCorrection.findMany({ where: { predictionId: { in: rows.map((r) => r.predictionId) } }, orderBy: { createdAt: "asc" } })
    : [];
  const effective = new Map(
    applyCorrections(
      rows.map((r) => ({ predictionId: r.predictionId, result: r.result as SettleResult, actual: r.actual, closingProb: r.closingProb, closingPrice: r.closingPrice })),
      corrections.map((c) => ({ predictionId: c.predictionId, result: c.result as SettleResult, actual: c.actual, closingProb: c.closingProb, closingPrice: c.closingPrice, createdAt: c.createdAt })),
    ).map((e) => [e.predictionId, e]),
  );
  return rows.flatMap((r) =>
    // Never cast a snapshot whose stamped schema version isn't one evaluation
    // knows how to read (audit 2026-11-06, Lane 4 S6).
    r.prediction.probability === null || !KNOWN_LEAN_SCHEMAS.includes(r.prediction.run.featureSchemaVersion)
      ? []
      : [
          {
            features: r.prediction.featureSnapshot as unknown as LeanFeatures,
            prob: r.prediction.probability,
            result: effective.get(r.predictionId)!.result,
            closingProb: effective.get(r.predictionId)!.closingProb,
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
