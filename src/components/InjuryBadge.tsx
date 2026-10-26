import { INJURY_BADGE, type PlayerInjuryInfo } from "@/lib/injuries/status";

/** OUT / D / Q / P tag from tonight's injury report; the status and note ride in the tooltip. */
export function InjuryBadge({ injury }: { injury: PlayerInjuryInfo | null | undefined }) {
  if (!injury?.level) return null;
  const b = INJURY_BADGE[injury.level];
  const tone = b.off ? "bg-red-600 text-white" : injury.level === "questionable" ? "bg-amber-400 text-[#07080b]" : "bg-muted text-foreground";
  return (
    <span
      className={`ml-1.5 inline-flex shrink-0 items-center rounded px-1 py-px align-middle text-[9px] font-bold uppercase leading-none ${tone}`}
      title={`${injury.status}${injury.detail ? ` — ${injury.detail}` : ""}`}
    >
      {b.label}
    </span>
  );
}
