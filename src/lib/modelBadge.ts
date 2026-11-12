/**
 * Provenance labeling for model-priced plays (display only — nothing here
 * selects, filters, or stakes a play).
 *
 * A model earns a passing calibration grade only at a `trusted` verdict (see
 * lib/engine/trust.ts). Every other state — `marginal`, `unproven`, `thin`,
 * or no status at all — falls short: the model hasn't graded enough outcomes, or hasn't graded them
 * well enough, to trust its calibration. Plays from such a model still show,
 * carrying a chip with the model's actual track record (its report-card
 * standing and graded count) so the number is read for what it has earned.
 *
 * This module is pure and import-free so client components can use it; the
 * play-level wiring over engine types lives in lib/engine/provenance.ts.
 */

/**
 * Whether a calibration verdict falls short of a passing grade. Only
 * `trusted` passes; a missing status (null/undefined — no report card, no
 * baked snapshot) never counts as passing.
 */
export function isUnprovenVerdict(verdict: string | null | undefined): boolean {
  return verdict !== "trusted";
}

/**
 * The track-record chip for a model without a passing grade: what its
 * /models report card actually shows, and how many outcomes it was graded on
 * (`graded`, when known). Null for a trusted model — nothing to flag.
 *
 *   no card   "Not graded yet"
 *   thin      "Early record · 38 graded"
 *   marginal  "Even with baseline · 412 graded"
 *   unproven  "Not ahead of baseline · 412 graded"
 */
export function trackRecordLabel(verdict: string | null | undefined, graded?: number | null): string | null {
  if (!isUnprovenVerdict(verdict)) return null;
  const count = typeof graded === "number" && graded > 0 ? ` · ${graded.toLocaleString("en-US")} graded` : "";
  if (verdict === "thin") return `Early record${count}`;
  if (verdict === "marginal") return `Even with baseline${count}`;
  if (verdict === "unproven") return `Not ahead of baseline${count}`;
  if (verdict == null) return "Not graded yet";
  return `Report card: ${verdict}${count}`;
}
