/**
 * Confidence for the pre-built pools (lib/pools): each screener row and
 * builder prop leg gets its grade when the pool is built, from the leg's own
 * numbers plus the facts its source attached (`facts`, then dropped so the
 * stored rows stay small) and the stat's blend report card. Pure, given the
 * verdicts.
 */
import type { ReportedVerdicts } from "@/lib/engine/trust";
import { BLEND_PRICED_PROP_SPORTS, propBlendVerdict } from "@/lib/props/provenance";
import { compactConfidence, confidenceOf, type ConfidenceInput } from "@/lib/propModel/confidence";
import type { Rate } from "@/lib/builder/types";
import type { LegFacts } from "@/lib/props/parlayFinder";

export interface RowForConfidence {
  sport: string;
  /** The sport's stat key ("points"), for the report card. */
  statKey: string;
  archr: number | null;
  priceAmerican: number | null;
  /** The record the grade checks: L10, or the season when L10 is thin. */
  rate: Rate;
  /** Games of history when the source attached none. */
  fallbackGames: number;
  alt: boolean;
  /** NBA: projected minutes tonight. */
  projectedMinutes?: number | null;
  facts?: LegFacts;
}

/** The grade's inputs for a pool row (exported so diagnostics grade rows exactly as the pools do). */
export function poolConfidenceInput(r: RowForConfidence, verdicts: ReportedVerdicts): ConfidenceInput {
  return {
    archr: r.archr,
    marketChance: r.facts?.market ?? null,
    priceAmerican: r.priceAmerican,
    rate: r.rate,
    sampleGames: r.facts?.games ?? r.fallbackGames,
    blendVerdict: BLEND_PRICED_PROP_SPORTS.has(r.sport) ? propBlendVerdict(r.sport, r.statKey, verdicts) : undefined,
    injury: r.facts?.injury ?? null,
    minutes: r.projectedMinutes ? { projected: r.projectedMinutes, recent: r.facts?.recentMinutes ?? null } : null,
    alt: r.alt,
    z: r.facts?.z ?? null,
    side: r.facts?.side,
    sport: r.sport,
  };
}

export function poolConfidence(r: RowForConfidence, verdicts: ReportedVerdicts) {
  return compactConfidence(confidenceOf(poolConfidenceInput(r, verdicts)));
}

/** A record window, falling back to the longer one when it holds fewer than 5 games. */
export const recordOf = (short: Rate, long: Rate): Rate => (short[1] >= 5 ? short : long);
