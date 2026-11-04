import { unprovenBadgeLabel } from "@/lib/modelBadge";

/**
 * The provenance chip for a play priced by a model with no passing
 * calibration grade: "Unproven model — small sample". Renders nothing for a
 * trusted model. Muted on purpose — factual, not alarming; the model's
 * verdict and graded sample live on /models.
 */
export function UnprovenModelBadge({
  verdict,
  className = "",
}: {
  verdict: string | null | undefined;
  className?: string;
}) {
  const label = unprovenBadgeLabel(verdict);
  if (!label) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold leading-none text-muted-foreground ${className}`}
      title="This model's calibration hasn't earned a passing grade yet — see /models for its report card"
    >
      {label}
    </span>
  );
}
