"use client";

import type { MarketType } from "@/generated/prisma/client";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { buildSlipPickId, useSlip, type SlipSport } from "@/lib/slip/SlipContext";
import { BOOK_COLORS, BOOK_INITIALS } from "@/lib/odds/bookAllowlist";
import type { EventPrice } from "@/lib/queries/lobby";

/**
 * One sportsbook-style price cell: the number on top, the best price below, the
 * book that has it as a small tag. Tapping it adds that exact line to the Slip
 * (tap again to remove), the way a book's grid adds to a betslip.
 */
export function PriceButton({
  price,
  label,
  sport,
  matchId,
  matchLabel,
  marketType,
  side,
  selectionLabel,
}: {
  price: EventPrice | null;
  /** The line as shown on the button, e.g. "+3.5" or "O 224.5"; omitted for a moneyline. */
  label?: string;
  sport: SlipSport;
  matchId: string;
  matchLabel: string;
  marketType: MarketType;
  side: string;
  /** How the pick reads in the Slip, e.g. "Celtics +3.5". */
  selectionLabel: string;
}) {
  const { addPick, removePick, isInSlip } = useSlip();

  if (!price) {
    return (
      <div className="flex h-12 items-center justify-center rounded-lg bg-muted/50 text-xs text-muted-foreground/60" aria-label="Not priced">
        —
      </div>
    );
  }

  const id = buildSlipPickId({ sport, matchId, marketType, side, point: price.point, bookKey: price.bookKey });
  const inSlip = isInSlip(id);

  return (
    <button
      type="button"
      aria-pressed={inSlip}
      aria-label={`${selectionLabel} ${formatAmerican(price.priceAmerican)} at ${price.bookName}`}
      onClick={() =>
        inSlip
          ? removePick(id)
          : addPick({
              id,
              sport,
              matchId,
              matchLabel,
              selectionLabel,
              marketType,
              point: price.point,
              bookKey: price.bookKey,
              bookName: price.bookName,
              priceAmerican: price.priceAmerican,
              addedAt: Date.now(),
            })
      }
      className={`relative flex h-12 flex-col items-center justify-center rounded-lg px-1 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        inSlip
          ? "archr-pop bg-primary text-primary-foreground"
          : "bg-muted text-foreground hover:bg-muted-foreground/15"
      }`}
    >
      {label && (
        <span className={`text-[11px] font-medium leading-tight ${inSlip ? "text-primary-foreground/85" : "text-muted-foreground"}`}>
          {label}
        </span>
      )}
      <span className="font-mono text-[13px] font-semibold leading-tight">{formatAmerican(price.priceAmerican)}</span>
      <span
        className="absolute right-1 top-1 size-1.5 rounded-full"
        style={{ background: BOOK_COLORS[price.bookKey] ?? "#94a3b8" }}
        title={BOOK_INITIALS[price.bookKey] ?? price.bookName}
        aria-hidden
      />
    </button>
  );
}
