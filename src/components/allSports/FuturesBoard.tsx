import type { FuturesRow } from "@/lib/queries/allSports";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { BookBadge } from "@/components/BookBadge";
import { Logo } from "@/components/Logo";

const pct = (x: number | null) => (x === null ? "—" : x < 0.01 ? "<1%" : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);

/** A futures market: every contender, the books' de-vigged chance, and the best price against it. */
export function FuturesBoard({ rows }: { rows: FuturesRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_4.5rem_4rem] gap-2 border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Contender</span>
        <span className="text-right">Chance</span>
        <span className="text-right">Best</span>
        <span className="text-right">Edge</span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.name} className="grid grid-cols-[minmax(0,1fr)_3.5rem_4.5rem_4rem] items-center gap-2 px-3 py-2">
            <span className="flex min-w-0 items-center gap-2">
              <Logo sources={[r.logo]} alt={r.name} fallbackText={r.name.slice(0, 2).toUpperCase()} size={24} />
              <span className="truncate text-sm font-semibold text-foreground">{r.name}</span>
            </span>
            <span className="text-right font-mono text-sm text-foreground">{pct(r.fair)}</span>
            <span className="flex items-center justify-end gap-1 font-mono text-sm font-semibold text-foreground">
              {r.best ? (
                <>
                  {formatAmerican(r.best.priceAmerican)}
                  <BookBadge bookKey={r.best.bookKey} bookName={r.best.bookName} size={14} />
                </>
              ) : (
                "—"
              )}
            </span>
            <span className={`text-right font-mono text-xs font-bold ${r.ev !== null && r.ev >= 0.02 ? "text-emerald-600 dark:text-brand" : "text-muted-foreground"}`}>
              {r.ev === null ? "—" : `${r.ev >= 0 ? "+" : ""}${(r.ev * 100).toFixed(1)}%`}
            </span>
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
        Chance is each book&apos;s field de-vigged to 100% and averaged (two books or more per name). Edge is the best price at that chance — futures carry big margins, so true edges are rare.
      </p>
    </div>
  );
}
