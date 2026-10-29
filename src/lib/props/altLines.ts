/**
 * The alt-line ladder every props sheet reads up and down: the main line, a
 * few of ARCHR's own steps either side of it, and any alternates the books
 * hang. Pure; each sport picks its step and reads each rung its own way.
 */
import type { PropHitRateResult } from "./tally";

/** Lines on each side of the main one. */
export const ALT_STEPS = 4;

/** `main` ± ALT_STEPS × `step`, merged with the books' lines, above zero, ascending. */
export function altLinePoints(main: number, step: number, bookPoints: number[] = []): number[] {
  const own = Array.from({ length: ALT_STEPS * 2 + 1 }, (_, i) => main + (i - ALT_STEPS) * step).filter((p) => p > 0);
  return [...new Set([...own, ...bookPoints])].sort((a, b) => a - b);
}

/** One rung of the ladder, for one side. */
export interface AltLineRow {
  point: number;
  /** A book hangs this line. */
  posted: boolean;
  /** ARCHR's chance the side cashes here; null without a projection. */
  modelProb: number | null;
  /** Hit rates in the table's column order (each sport names its own windows). */
  rates: PropHitRateResult[];
  /** Best bettable price on this side at this line, if any book posts it. */
  best: { priceAmerican: number } | null;
}
