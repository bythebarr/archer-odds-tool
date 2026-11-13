import { prisma } from "@/lib/prisma";
import { SPORTS } from "@/lib/engine";
import type { ReportedVerdicts } from "@/lib/engine";
import { gradedCard, type GradedCard } from "@/lib/modelBadge";

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

/**
 * Each blend card's verdict from its latest /models report, keyed by the full
 * card key (`market-blend:<sport>:<stat>`, saved by
 * `npm run backtest:props-market`) — the card that grades the exact blend a
 * prop is priced with. Game-market blend cards (e.g. `market-blend:ufc:ml`)
 * ride along in the map; props resolution only ever reads prop-stat keys
 * (see lib/props/provenance). A stat with no saved card is absent from the
 * map, and absence reads as unproven there.
 */
export async function getReportedBlendVerdicts(): Promise<ReportedVerdicts> {
  const rows = await prisma.modelReport.findMany({
    where: { model: { startsWith: "market-blend:" } },
    orderBy: { createdAt: "desc" },
    distinct: ["model"],
    select: { model: true, verdict: true },
  });
  return new Map(rows.map((r) => [r.model, r.verdict]));
}

/**
 * How many outcomes each model's latest /models report card was graded on,
 * keyed like the verdict maps (sport key, or `market-blend:<sport>:<stat>`).
 * Display only: it fills the track-record chips' counts.
 */
export async function getReportedGraded(): Promise<Record<string, GradedCard>> {
  const rows = await prisma.modelReport.findMany({
    orderBy: { createdAt: "desc" },
    distinct: ["model"],
    select: { model: true, n: true, brier: true, baseRateBrier: true },
  });
  return Object.fromEntries(rows.map((r) => [r.model, gradedCard(r)]));
}
