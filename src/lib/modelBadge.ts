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

/** The words every surface uses for a model's report-card standing (see /learn#report-card). */
export type VerdictLabel = "Trusted" | "Marginal" | "Thin" | "Not graded yet";

/**
 * A /models verdict in the app's one vocabulary:
 *   trusted  → Trusted
 *   marginal → Marginal
 *   unproven → Marginal (graded, not beating the no-skill baseline: the tooltip and /models say how far short)
 *   thin     → Thin
 *   none     → Not graded yet
 */
export function verdictLabel(verdict: string | null | undefined): VerdictLabel {
  if (verdict === "trusted") return "Trusted";
  if (verdict === "marginal" || verdict === "unproven") return "Marginal";
  if (verdict === "thin") return "Thin";
  return "Not graded yet";
}

/**
 * The track-record chip for a model without a passing grade: its standing in
 * the one vocabulary and how many outcomes it was graded on (`graded`, when
 * known). Null for a trusted model — nothing to flag.
 *
 *   thin      "Thin · 38 graded"
 *   marginal  "Marginal · 412 graded"
 *   no card   "Not graded yet"
 */
export function trackRecordLabel(verdict: string | null | undefined, graded?: number | null): string | null {
  if (!isUnprovenVerdict(verdict)) return null;
  const label = verdictLabel(verdict);
  if (label === "Not graded yet") return label;
  return typeof graded === "number" && graded > 0 ? `${label} · ${graded.toLocaleString("en-US")} graded` : label;
}
