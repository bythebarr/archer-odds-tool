/**
 * Bound x to [lo, hi]. One shared copy — the MLB prop projection and the UFC
 * strength/style modules each carried an identical local clamp before the
 * Phase 5 consolidation.
 */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
