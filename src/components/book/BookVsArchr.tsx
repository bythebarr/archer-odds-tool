import { formatAmerican } from "@/lib/odds/americanOdds";
import { formatSpreadPoint } from "@/lib/odds/americanOdds";
import { bookShort, formatArchrLine, lineTone, staleDate, type ArchrLine } from "@/lib/odds/bookVsArchr";

const TONE: Record<"value" | "worse" | "even", string> = {
  value: "text-emerald-600 dark:text-emerald-400",
  worse: "text-red-600 dark:text-red-400",
  even: "text-foreground",
};

/**
 * Book line vs ARCHR line on one line: "DK −110 · ARCHR −135". The book's
 * number is green when it beats ARCHR's fair line, red when it's worse; a
 * stale price carries its own date ("price from Nov 1"). Without an ARCHR
 * read the book shows alone; without a price the book reads "—". Plain
 * component (no hooks), for server and client trees.
 */
export function BookVsArchr({
  price,
  archr,
  label,
  className = "",
}: {
  price: { priceAmerican: number; bookKey: string; bookName?: string; point?: number | null; polledAt?: string | null } | null;
  archr: ArchrLine | null;
  /** The book's number as shown ("O 8.5"); defaults to the point, or the price on a moneyline/prop. */
  label?: string;
  className?: string;
}) {
  const p = price ? { ...price, point: price.point ?? null } : null;
  const tone = p ? lineTone(p, archr) : null;
  const stale = p ? staleDate(p.polledAt) : null;
  // A spread or total compares the number: the price rides after it, muted.
  const numbered = p !== null && p.point !== null && archr !== null && archr.kind !== "price";
  return (
    <span className={`inline-flex flex-col ${className}`}>
      <span className="inline-flex items-baseline gap-x-1 whitespace-nowrap font-mono text-[12.5px] font-semibold">
        {p ? (
          <>
            <span className={tone ? TONE[tone] : "text-foreground"}>
              {bookShort(p.bookKey, p.bookName)} {numbered ? vsBookLine(p, label) : formatAmerican(p.priceAmerican)}
            </span>
            {numbered && <span className="text-[11px] font-medium text-muted-foreground">{formatAmerican(p.priceAmerican)}</span>}
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
        {archr && (
          <>
            <span aria-hidden className="text-muted-foreground/60">·</span>
            <span className="font-medium text-muted-foreground">ARCHR {formatArchrLine(archr)}</span>
          </>
        )}
      </span>
      {stale && <span className="text-[10px] leading-tight text-muted-foreground">price from {stale}</span>}
    </span>
  );
}

/** A book price as a book-vs-ARCHR cell reads it. */
export interface VsPrice {
  priceAmerican: number;
  bookKey: string;
  bookName?: string;
  /** Spread/total number; null for a moneyline. */
  point: number | null;
  polledAt?: string | null;
}

/** The book's side of a cell: the number being compared (the spread/total point, else the price). */
export function vsBookLine(price: VsPrice, label?: string): string {
  if (price.point === null) return formatAmerican(price.priceAmerican);
  return label ?? formatSpreadPoint(price.point);
}

/** What a screen reader hears for one cell. */
export function vsAriaLabel(selection: string, price: VsPrice, archr: ArchrLine | null, label?: string): string {
  const stale = staleDate(price.polledAt);
  return `${selection}: ${price.bookName ?? bookShort(price.bookKey)} ${vsBookLine(price, label)}${price.point !== null ? ` at ${formatAmerican(price.priceAmerican)}` : ""}${archr ? `, ARCHR ${formatArchrLine(archr)}` : ""}${stale ? `, price from ${stale}` : ""}`;
}

/**
 * The inside of a book-vs-ARCHR price cell, shared by every grid (league
 * rows, the homepage, game and event boards): the book's line ("DK +3.5",
 * green/red against ARCHR), its price under a spread or total, the price's
 * own date when it's stale, then ARCHR's line. `selected`: the cell is in the
 * slip (inverted colors, no tone).
 */
export function VsCellBody({ price, archr, label, selected = false }: { price: VsPrice; archr: ArchrLine | null; label?: string; selected?: boolean }) {
  const tone = lineTone(price, archr);
  const stale = staleDate(price.polledAt);
  const muted = selected ? "text-primary-foreground/80" : "text-muted-foreground";
  return (
    <>
      <span className={`whitespace-nowrap font-mono text-[11.5px] font-semibold leading-tight ${selected || !tone ? "" : TONE[tone]}`}>
        {bookShort(price.bookKey, price.bookName)} {vsBookLine(price, label)}
      </span>
      {price.point !== null && <span className={`whitespace-nowrap font-mono text-[10.5px] leading-tight ${muted}`}>{formatAmerican(price.priceAmerican)}</span>}
      {stale && <span className={`whitespace-nowrap text-[9px] leading-tight ${muted}`}>price from {stale}</span>}
      {archr && <span className={`whitespace-nowrap font-mono text-[10.5px] leading-tight ${muted}`}>ARCHR {formatArchrLine(archr)}</span>}
    </>
  );
}

/** A cell with no book price yet: "—", with ARCHR's line under it when it has one. */
export function VsEmptyCell({ archr }: { archr: ArchrLine | null }) {
  return (
    <div className="flex min-h-12 flex-col items-center justify-center rounded-lg bg-muted/50 px-1 py-1 text-center" aria-label="Not priced">
      <span className="text-xs text-muted-foreground/60">—</span>
      {archr && <span className="font-mono text-[10.5px] leading-tight text-muted-foreground">ARCHR {formatArchrLine(archr)}</span>}
    </div>
  );
}
