import type { StatCategory } from "@/generated/prisma/client";
import type { PropHitRateResult } from "./hitRate";

export const STAT_CATEGORY_LABELS: Record<StatCategory, string> = {
  hits: "Hits",
  totalBases: "Total Bases",
  homeRuns: "Home Runs",
  rbi: "RBI",
  runs: "Runs",
  battingStrikeouts: "Strikeouts (Batting)",
  pitcherStrikeouts: "Strikeouts (Pitching)",
  earnedRuns: "Earned Runs",
  hitsAllowed: "Hits Allowed",
  walksAllowed: "Walks Allowed",
  outsRecorded: "Outs Recorded",
};

/** Sane starting line per stat category — reseeded whenever the user switches category. */
export const STAT_CATEGORY_DEFAULT_LINE: Record<StatCategory, number> = {
  hits: 0.5,
  totalBases: 1.5,
  homeRuns: 0.5,
  rbi: 0.5,
  runs: 0.5,
  battingStrikeouts: 1.5,
  pitcherStrikeouts: 4.5,
  earnedRuns: 2.5,
  hitsAllowed: 5.5,
  walksAllowed: 1.5,
  outsRecorded: 15.5,
};

export function formatPropHitRate(r: PropHitRateResult): string {
  if (r.sampleSize === 0) return "no games";
  const pct = r.hitRate !== null ? `${Math.round(r.hitRate * 100)}%` : "—";
  return `${r.hits}-${r.sampleSize - r.hits} (${pct})`;
}
