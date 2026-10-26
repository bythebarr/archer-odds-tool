import { EV_FLAG, type PriceValue } from "@/lib/odds/marketValue";
import { formatAmerican } from "@/lib/odds/americanOdds";

/**
 * The value read on a price: "+3.1% EV" in volt when the price beats the rest
 * of the market's fair price by more than the noise floor, nothing otherwise.
 * The fair price and the books behind it ride in the tooltip.
 */
export function EvTag({ value, className = "" }: { value: PriceValue | null; className?: string }) {
  if (!value || value.ev < EV_FLAG) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md bg-brand px-1.5 py-0.5 font-mono text-[11px] font-bold leading-none text-brand-foreground ${className}`}
      title={`Fair ${formatAmerican(value.fairAmerican)} from ${value.booksUsed} other books`}
    >
      +{(value.ev * 100).toFixed(1)}%
    </span>
  );
}
