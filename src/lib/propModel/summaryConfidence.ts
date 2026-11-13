/**
 * The Confidence grade for a prop as the finders and player sheets show it,
 * from each sport's prop summary: one function per sport, so the grade on a
 * finder card always equals the grade on the sheet it opens. Pure; the
 * scoring itself is lib/propModel/confidence.
 */
import type { PropDirection } from "@/lib/props/tally";
import type { PropSummary } from "@/lib/nba/propsMath";
import type { NflPropSummary } from "@/lib/nfl/propsMath";
import { confidenceOf, type Confidence } from "./confidence";

export interface SummaryContext {
  /** The stat's blend report-card verdict (absent card = null). */
  blendVerdict: string | null;
  injury: string | null;
  /** True on an alternate rung (not the book's main number). */
  alt: boolean;
}

/** NBA: the record is L10, or the season while L10 holds fewer than 5 games. */
export function nbaSummaryConfidence(summary: PropSummary, side: PropDirection, ctx: SummaryContext): Confidence | null {
  const m = summary.model;
  if (!m) return null;
  const over = side === "over";
  const l10 = summary.hitRates.l10;
  const rec = l10.sampleSize >= 5 ? l10 : summary.hitRates.season;
  const quote = over ? summary.over : summary.under;
  return confidenceOf({
    archr: over ? m.probOver : m.probUnder,
    marketChance: m.market ? (over ? m.market.probOver : 1 - m.market.probOver) : null,
    priceAmerican: summary.projected ? null : (quote?.priceAmerican ?? null),
    rate: [rec.hits, rec.sampleSize],
    sampleGames: m.projection.games,
    blendVerdict: ctx.blendVerdict,
    injury: ctx.injury,
    minutes: { projected: m.projection.minutes, recent: summary.avgMinutesL5 },
    alt: ctx.alt,
    z: ((m.projection.mean - summary.point) / Math.max(m.projection.sd, 1e-6)) * (over ? 1 : -1),
    side,
    sport: "nba",
  });
}

/** NFL: the record is L10 when it holds 5+ games, else the season. */
export function nflSummaryConfidence(s: NflPropSummary, side: PropDirection, ctx: SummaryContext): Confidence | null {
  const m = s.model;
  if (!m) return null;
  const record = s.splits.find((x) => x.key === "l10" && x.rate.sampleSize >= 5) ?? s.splits.find((x) => x.key === "season");
  const quote = side === "over" ? s.over : s.under;
  return confidenceOf({
    archr: side === "over" ? m.probOver : m.probUnder,
    marketChance: m.market ? (side === "over" ? m.market.probOver : 1 - m.market.probOver) : null,
    priceAmerican: s.projected ? null : (quote?.priceAmerican ?? null),
    rate: record ? [record.rate.hits, record.rate.sampleSize] : [0, 0],
    sampleGames: m.projection.games,
    blendVerdict: ctx.blendVerdict,
    injury: ctx.injury,
    alt: ctx.alt,
    z: ((m.projection.mean - s.point) / Math.max(m.projection.sd, 1e-6)) * (side === "over" ? 1 : -1),
    side,
    sport: "nfl",
  });
}
