/**
 * Pure display-formatting helper for the NFL research matchup card — no DOM,
 * no React, so it's unit-testable directly (mirrors
 * `src/components/cfb/lineFieldSync.ts`'s reason for being its own module).
 * Never computes anything new: it's a display transform of the model's own
 * `expectedHomeMargin`, the exact same value already shown/stored elsewhere.
 */

/**
 * "Rams -7.3" / "Giants -3.0" / "Rams/Giants pick'em" — the sportsbook
 * convention of naming the favored side with a negative number. Deliberately
 * produces a plain point-spread-shaped LABEL, never a percentage or the word
 * "probability"/"cover" — this is a margin, not a cover probability, and the
 * string shape itself should make that impossible to confuse (see this
 * module's own test for an explicit check).
 */
export function projectedLineLabel(homeAbbr: string, awayAbbr: string, expectedHomeMargin: number): string {
  const rounded = Math.round(Math.abs(expectedHomeMargin) * 10) / 10;
  if (rounded === 0) return `${homeAbbr}/${awayAbbr} pick'em`;
  const favored = expectedHomeMargin > 0 ? homeAbbr : awayAbbr;
  return `${favored} -${rounded}`;
}
