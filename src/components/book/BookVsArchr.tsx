import { formatAmerican } from "@/lib/odds/americanOdds";
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
  className = "",
}: {
  price: { priceAmerican: number; bookKey: string; bookName?: string; point?: number | null; polledAt?: string | null } | null;
  archr: ArchrLine | null;
  className?: string;
}) {
  const tone = price ? lineTone({ priceAmerican: price.priceAmerican, point: price.point ?? null }, archr) : null;
  const stale = price ? staleDate(price.polledAt) : null;
  return (
    <span className={`inline-flex flex-col ${className}`}>
      <span className="inline-flex items-baseline gap-x-1 whitespace-nowrap font-mono text-[12.5px] font-semibold">
        {price ? (
          <span className={tone ? TONE[tone] : "text-foreground"}>
            {bookShort(price.bookKey, price.bookName)} {formatAmerican(price.priceAmerican)}
          </span>
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
