import Link from "next/link";
import type { TopProp } from "@/lib/queries/nbaProps";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { Logo } from "@/components/Logo";
import { BookBadge } from "@/components/BookBadge";

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);
}

/** Horizontally scrolling prop cards — the lobby's way into the props finder. */
export function TopPropsStrip({ props }: { props: TopProp[] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      <ul className="flex gap-2.5">
        {props.map((p) => (
          <li key={`${p.playerId}:${p.stat}:${p.side}`} className="w-44 shrink-0">
            <Link
              href={`/nba/${p.gameId}?tab=props&stat=${p.stat}&side=${p.side}`}
              className="flex h-full flex-col rounded-xl border border-border bg-card p-3 transition-colors hover:border-foreground/20"
            >
              <div className="flex items-center gap-2">
                <Logo sources={[p.headshotUrl]} alt={p.playerName} fallbackText={initials(p.playerName)} size={36} fit="cover" />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold leading-tight text-foreground">{p.playerName}</p>
                  <p className="text-[11px] text-muted-foreground">{p.matchup}</p>
                </div>
              </div>
              <p className="mt-2.5 text-sm font-bold text-foreground">
                {p.side === "over" ? "Over" : "Under"} {p.point} <span className="text-xs font-semibold text-muted-foreground">{p.statShort}</span>
              </p>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  {p.hits}/{p.sample} L10
                </span>
                <span className="inline-flex items-center gap-1 font-mono text-[13px] font-semibold text-foreground">
                  {formatAmerican(p.priceAmerican)}
                  <BookBadge bookKey={p.bookKey} bookName={p.bookName} size={16} />
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
