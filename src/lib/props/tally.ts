/** Client-safe hit-rate counting, shared by the MLB hit-rate engine and the NBA props finder. */

export type PropDirection = "over" | "under";

export interface PropHitRateResult {
  hits: number;
  /** Games actually found — may be less than the requested window (e.g. early season, or a tight hand-split filter). */
  sampleSize: number;
  /** null when sampleSize is 0 — nothing to compute a rate from. */
  hitRate: number | null;
}

/**
 * Pure hit-counting core, used by computePropHitRate so it's testable
 * without a database — given the already-fetched stat values for whichever
 * games qualified (window + hand-filter already applied), just counts
 * over/under against the line.
 */
export function tallyPropHits(values: number[], line: number, direction: PropDirection): PropHitRateResult {
  const hits = values.filter((v) => (direction === "over" ? v > line : v < line)).length;
  return {
    hits,
    sampleSize: values.length,
    hitRate: values.length > 0 ? hits / values.length : null,
  };
}
