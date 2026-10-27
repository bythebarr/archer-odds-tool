"use client";

import type { MarketType } from "@/generated/prisma/client";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { buildSlipPickId, useSlip, type SlipSport } from "@/lib/slip/SlipContext";
import { BookBadge } from "@/components/BookBadge";
import type { EventPrice } from "@/lib/queries/lobby";
import { EV_FLAG } from "@/lib/odds/marketValue";

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
  // A price that beats the rest of the market's fair price by more than the noise floor.
  const ev = price.value && price.value.ev >= EV_FLAG ? price.value.ev : null;

  return (
    <button
      type="button"
      aria-pressed={inSlip}
      aria-label={`${selectionLabel} ${formatAmerican(price.priceAmerican)} at ${price.bookName}${ev !== null ? `, plus ${(ev * 100).toFixed(1)} percent expected value` : ""}`}
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
          : `bg-muted text-foreground hover:bg-muted-foreground/15 ${ev !== null ? "ring-1 ring-inset ring-brand" : ""}`
      }`}
      title={price.value ? `Fair ${formatAmerican(price.value.fairAmerican)} from ${price.value.booksUsed} other books` : undefined}
    >
      {ev !== null && (
        <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded bg-brand px-1 font-mono text-[9px] font-bold leading-[14px] text-brand-foreground">
          +{(ev * 100).toFixed(1)}%
        </span>
      )}
      {label && (
        <span className={`text-[11px] font-medium leading-tight ${inSlip ? "text-primary-foreground/85" : "text-muted-foreground"}`}>
          {label}
        </span>
      )}
      <span className="flex items-center gap-1 font-mono text-[13px] font-semibold leading-tight">
        {formatAmerican(price.priceAmerican)}
        {/* The book that has this price, as its own app icon. */}
        <span className="shrink-0 overflow-hidden rounded-full ring-1 ring-black/10" title={price.bookName} aria-hidden>
          <BookBadge bookKey={price.bookKey} bookName={price.bookName} size={12} />
        </span>
      </span>
    </button>
  );
}
