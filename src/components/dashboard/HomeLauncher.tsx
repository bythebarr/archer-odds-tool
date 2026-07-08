import Link from "next/link";
import type { HomeData } from "@/lib/queries/dashboard";
import type { SlateSide } from "@/lib/queries/slate";
import { SPORT_META, SPORT_ORDER } from "@/lib/sports";
import { SportCard } from "@/components/SportCard";
import { CompetitorAvatar } from "./CompetitorAvatar";

function timeLabel(startUtc: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(startUtc);
}

/** Short display for a competitor — a compact code when we have one, else the full name (truncated by the row). */
function shortLabel(side: SlateSide): string {
  return side.meta && side.meta.length <= 4 ? side.meta : side.name;
}

/* ── Up next strip ───────────────────────────────────────────────────────── */

function UpNextRow({ row }: { row: HomeData["upNext"][number] }) {
  return (
    <Link href={row.href} className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50">
      <span aria-hidden className="text-sm">
        {SPORT_META[row.sport].icon}
      </span>
      <span className="flex shrink-0 items-center -space-x-1.5">
        <CompetitorAvatar sport={row.sport} side={row.away} size={22} />
        <CompetitorAvatar sport={row.sport} side={row.home} size={22} />
      </span>
      <span className="min-w-0 truncate text-sm text-foreground">
        {shortLabel(row.away)} <span className="text-muted-foreground">vs</span> {shortLabel(row.home)}
      </span>
      <time className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
        {timeLabel(row.startUtc)}
      </time>
    </Link>
  );
}

export function HomeLauncher({ home, date }: { home: HomeData; date: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sports</h2>
        <Link href={`/sports?date=${date}`} className="text-xs font-medium text-primary hover:underline">
          All Sports →
        </Link>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {SPORT_ORDER.map((sport) => {
          const s = home.sports.find((x) => x.sport === sport)!;
          return <SportCard key={sport} {...s} date={date} />;
        })}
      </div>

      <Link
        href={`/slate?date=${date}`}
        className="mt-4 flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 transition-colors hover:bg-emerald-500/15"
      >
        <span className="text-lg" aria-hidden="true">🎯</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">
            {home.edges > 0 ? (
              <>
                {home.edges} +value play{home.edges === 1 ? "" : "s"} on the board
              </>
            ) : (
              "Shop the full slate"
            )}
          </span>
          <span className="block text-xs text-muted-foreground">
            {home.edges > 0 ? "Best price vs the market, sortable by your odds range" : "Every priced play in one pool, by price"}
          </span>
        </span>
        <span className="shrink-0 text-sm font-medium text-primary">→</span>
      </Link>

      <section className="mt-7">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Up next</h2>
          <Link href={`/slate?date=${date}`} className="text-xs font-medium text-primary hover:underline">
            Full slate →
          </Link>
        </div>
        <div className="mt-2 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {home.upNext.length === 0 ? (
            <div className="px-3 py-5 text-center text-sm text-muted-foreground">That&apos;s a wrap for today.</div>
          ) : (
            home.upNext.map((row) => <UpNextRow key={row.key} row={row} />)
          )}
        </div>
      </section>
    </div>
  );
}
