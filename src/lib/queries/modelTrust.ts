import { prisma } from "@/lib/prisma";
import { SPORTS } from "@/lib/engine";
import type { ReportedVerdicts } from "@/lib/engine";

/**
 * Each sport model's verdict from its latest /models report card. The sport
 * models save under their sport key (`npm run backtest:all` → "mlb", "ufc",
 * "tennis"), the same rows /models renders, so the page and the posting gate
 * can't disagree. A sport with no saved report is absent; the gate then falls
 * back to the baked snapshot (see lib/engine/trust.ts).
 */
export async function getReportedVerdicts(): Promise<ReportedVerdicts> {
  const rows = await prisma.modelReport.findMany({
    where: { model: { in: SPORTS.map((s) => s.key) } },
    orderBy: { createdAt: "desc" },
    distinct: ["model"],
    select: { model: true, verdict: true },
  });
  return new Map(rows.map((r) => [r.model, r.verdict]));
}
