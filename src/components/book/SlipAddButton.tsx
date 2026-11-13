"use client";

import { buildSlipPickId, useSlip, type SlipPick } from "@/lib/slip/SlipContext";

/** The +/✓ control that adds a line to the personal slip (or takes it off) without leaving the row. */
export function SlipAddButton({ line }: { line: Omit<SlipPick, "addedAt" | "id"> & { side: string } }) {
  const { addPick, removePick, isInSlip } = useSlip();
  const { side, ...rest } = line;
  const pick = { ...rest, id: buildSlipPickId({ sport: line.sport, matchId: line.matchId, marketType: line.marketType, side, point: line.point, bookKey: line.bookKey }) };
  const inSlip = isInSlip(pick.id);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (inSlip) removePick(pick.id);
        else addPick({ ...pick, addedAt: Date.now() });
      }}
      aria-pressed={inSlip}
      aria-label={inSlip ? `Remove ${pick.selectionLabel} from slip` : `Add ${pick.selectionLabel} to slip`}
      className={`flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors ${
        inSlip ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
      }`}
    >
      <svg viewBox="0 0 16 16" fill="none" className="size-3.5" aria-hidden>
        {inSlip ? (
          <path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        )}
      </svg>
    </button>
  );
}
