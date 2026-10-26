import { prisma } from "@/lib/prisma";
import { MIN_FIT_SAMPLES } from "@/lib/propModel/market";

/**
 * The model-vs-market weights fitted by `npm run backtest:props-market`, per
 * stat, from the latest saved report for each (`market-blend:<sport>:<stat>`).
 * A stat whose fit has fewer than MIN_FIT_SAMPLES graded props is left out, so
 * the pipeline's default holds for it.
 */
export async function getModelWeights(sport: "nba" | "nfl"): Promise<Record<string, number>> {
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
