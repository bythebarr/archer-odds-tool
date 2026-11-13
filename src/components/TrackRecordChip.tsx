import { trackRecordLabel, type GradedCard } from "@/lib/modelBadge";

/**
 * The track-record chip on a play priced by a model without a passing
 * calibration grade: its /models standing and how many outcomes it was graded
 * on, e.g. "Even with baseline · 412 graded". Renders nothing for a trusted
 * model. Muted on purpose — factual, not alarming; the full report card lives
 * on /models.
 */
export function TrackRecordChip({
  verdict,
  graded,
  className = "",
}: {
  verdict: string | null | undefined;
  /** Outcomes the model's latest report card graded, when known. */
  graded?: number | GradedCard | null;
  className?: string;
}) {
  const label = trackRecordLabel(verdict, graded);
  if (!label) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold leading-none text-muted-foreground ${className}`}
      title="This model's report card on /models: how it has graded out against a no-skill baseline, and on how many outcomes. Lean on the market's price until it earns a passing grade."
    >
      {label}
    </span>
  );
}
