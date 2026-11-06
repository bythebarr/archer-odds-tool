/**
 * Provenance labeling for model-priced plays (display only — nothing here
 * selects, filters, or stakes a play).
 *
 * A model earns a passing calibration grade only at a `trusted` verdict (see
 * lib/engine/trust.ts). Every other state — `marginal`, `unproven`, `thin`,
 * or no status at all — is UNPROVEN: the model hasn't graded enough outcomes,
 * or hasn't graded them well enough, to trust its calibration. Plays from
 * such a model still show (transparency while the sample builds), but they
 * carry a badge so nobody mistakes the number for a proven one.
 *
 * This module is pure and import-free so client components can use it; the
 * play-level wiring over engine types lives in lib/engine/provenance.ts.
 */

/** The exact badge copy shown on a play priced by an unproven model. */
export const UNPROVEN_MODEL_BADGE = "Unproven model — small sample";

/**
 * Whether a calibration verdict counts as unproven. Only `trusted` is a
 * passing grade; a missing status (null/undefined — no report card, no baked
 * snapshot) is treated as unproven, never assumed proven.
 */
export function isUnprovenVerdict(verdict: string | null | undefined): boolean {
  return verdict !== "trusted";
}

/** The badge copy to render for a verdict, or null when the model is proven. */
export function unprovenBadgeLabel(verdict: string | null | undefined): string | null {
  return isUnprovenVerdict(verdict) ? UNPROVEN_MODEL_BADGE : null;
}
