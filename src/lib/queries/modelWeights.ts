import { prisma } from "@/lib/prisma";
import { MIN_FIT_SAMPLES } from "@/lib/propModel/market";

/**
 * The model-vs-market weights fitted by `npm run backtest:props-market`, per
 * stat, from the latest saved report for each (`market-blend:<sport>:<stat>`).
 * A stat whose fit has fewer than MIN_FIT_SAMPLES graded props is left out, so
 * the pipeline's default holds for it.
 */
export async function getModelWeights(sport: "nba" | "nfl" | "ufc" | "f1"): Promise<Record<string, number>> {
  const reports = await prisma.modelReport.findMany({
    where: { model: { startsWith: `market-blend:${sport}:` } },
    orderBy: { createdAt: "desc" },
    select: { model: true, n: true, extra: true },
  });
  const out: Record<string, number> = {};
  for (const r of reports) {
    const stat = r.model.split(":")[2];
    if (!stat || stat in out) continue;
    const w = (r.extra as { modelWeight?: unknown } | null)?.modelWeight;
    if (typeof w === "number" && r.n >= MIN_FIT_SAMPLES) out[stat] = w;
  }
  return out;
}

/** The widest a fitted calibration factor may move the baked shrink, either way. */
const SHRINK_FACTOR_RANGE: [number, number] = [0.7, 1.3];

/**
 * Per stat, the calibration factor the latest props backtest fitted on top of
 * the baked shrink (`<prefix>:<stat>` report cards' time-split refit). Kept only
 * when it had MIN_FIT_SAMPLES and actually scored better on the held-out games,
 * and clamped; a stat left out keeps the baked shrink.
 */
export async function getCalibrationFactors(prefix: "nba-props" | "nfl-props"): Promise<Record<string, number>> {
  const reports = await prisma.modelReport.findMany({
    where: { model: { startsWith: `${prefix}:` } },
    orderBy: { createdAt: "desc" },
    select: { model: true, n: true, detail: true },
  });
  const out: Record<string, number> = {};
  const seen = new Set<string>();
  for (const r of reports) {
    const stat = r.model.split(":")[1];
    if (!stat || seen.has(stat)) continue;
    seen.add(stat);
    const refit = (r.detail as { refit?: { bestShrink?: number; testBrierAsIs?: number; testBrierShrunk?: number } } | null)?.refit;
    if (r.n < MIN_FIT_SAMPLES || !refit?.bestShrink || refit.testBrierShrunk === undefined || refit.testBrierAsIs === undefined) continue;
    if (!(refit.testBrierShrunk < refit.testBrierAsIs)) continue;
    out[stat] = Math.min(SHRINK_FACTOR_RANGE[1], Math.max(SHRINK_FACTOR_RANGE[0], refit.bestShrink));
  }
  return out;
}
