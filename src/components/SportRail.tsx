import Link from "next/link";
import { getSportNav } from "@/lib/queries/sportNav";
import { NAV_SPORT_META, sportHref } from "@/lib/sports";

/**
 * The books-style quick-jump rail: in-season sports first (with a live count),
 * off-season sports dimmed, and an "All Sports" pill that opens the /sports
 * lobby. Horizontally scrollable so it never wraps or pushes content down.
 * Self-fetches its counts from the request-cached slate.
 */
export async function SportRail({ date }: { date: string }) {
  const items = await getSportNav(date);
  // In-season (has games today) first; stable within each group.
  const sorted = [...items].sort((a, b) => Number(b.count > 0) - Number(a.count > 0));

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {sorted.map(({ sport, count }) => {
        const meta = NAV_SPORT_META[sport];
        const live = count > 0;
        return (
          <Link
            key={sport}
            href={sportHref(sport, date)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              live
                ? "border-border bg-card text-foreground hover:border-primary/50"
                : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            <span aria-hidden>{meta.icon}</span>
            {meta.label}
            {live && (
              <span className="rounded-full bg-primary/10 px-1.5 text-xs font-semibold tabular-nums text-primary">
                {count}
              </span>
            )}
          </Link>
        );
      })}
      <Link
        href={`/sports?date=${date}`}
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      >
        All Sports →
      </Link>
    </div>
  );
}
