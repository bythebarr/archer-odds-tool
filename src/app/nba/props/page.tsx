import type { Metadata } from "next";
import Link from "next/link";
import { getNbaPropsFinder, type NbaPropRow, type NbaPropSort } from "@/lib/queries/nbaProps";
import { NBA_PROP_STATS, NBA_PROP_STAT_BY_KEY } from "@/lib/nba/propStats";
import type { PropDirection, PropHitRateResult } from "@/lib/props/hitRate";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { todayEt, isValidEtDate } from "@/lib/dateEt";
import { getFeedFreshness } from "@/lib/freshness";
import { PageShell, PageHeader } from "@/components/PageShell";
import { DateNav } from "@/components/DateNav";
import { EmptyState } from "@/components/EmptyState";
import { BookBadge } from "@/components/BookBadge";
import { Logo } from "@/components/Logo";
import type { NbaPropStat } from "@/generated/prisma/client";

export const metadata: Metadata = {
  title: "NBA Props — best price and hit rate at every line",
  description:
    "NBA player props: the best Over and Under across sportsbooks at the consensus line, next to how often each player has cleared it.",
};

export const dynamic = "force-dynamic";

const SORTS: { key: NbaPropSort; label: string }[] = [
  { key: "hitRate", label: "L10 hit rate" },
  { key: "margin", label: "L10 avg vs line" },
  { key: "price", label: "Best price" },
];

interface Params {
  date?: string;
  stat?: string;
  side?: string;
  sort?: string;
  game?: string;
}

function hrefWith(current: Required<Omit<Params, "game">> & { game?: string }, change: Partial<Params>): string {
  const next = { ...current, ...change };
  const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]);
  return `/nba/props?${qs.toString()}`;
}

function chipClass(active: boolean): string {
  return `rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
    active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
  }`;
}

function rateClass(rate: PropHitRateResult): string {
  if (rate.hitRate === null || rate.sampleSize < 3) return "text-muted-foreground";
  if (rate.hitRate >= 0.7) return "text-emerald-600 dark:text-emerald-400";
  if (rate.hitRate <= 0.3) return "text-red-600 dark:text-red-400";
  return "text-foreground";
}

function RateCell({ label, rate }: { label: string; rate: PropHitRateResult }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`font-mono text-sm font-semibold ${rateClass(rate)}`}>
        {rate.sampleSize === 0 ? "—" : `${rate.hits}/${rate.sampleSize}`}
      </span>
    </div>
  );
}

function PriceCell({ label, best, active }: { label: string; best: NbaPropRow["over"]; active: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 rounded-md px-2 py-1 ${active ? "bg-muted" : ""}`}>
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {best ? (
        <>
          <span className={`font-mono text-sm ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
            {formatAmerican(best.priceAmerican)}
          </span>
          <BookBadge bookKey={best.bookKey} bookName={best.bookName} size={18} />
        </>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      )}
    </div>
  );
}

function PropCard({ row, side, statShort }: { row: NbaPropRow; side: PropDirection; statShort: string }) {
  const initials = row.playerName
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);
  return (
    <li className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Logo sources={row.headshotUrl ? [row.headshotUrl] : []} alt={row.playerName} fallbackText={initials} size={36} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{row.playerName}</p>
            <p className="text-xs text-muted-foreground">
              {row.matchup}
              {row.avgMinutesL5 !== null && ` · ${Math.round(row.avgMinutesL5)} min L5`}
              {row.avgL10 !== null && ` · ${row.avgL10.toFixed(1)} ${statShort} L10`}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-base font-semibold text-foreground">{row.point}</p>
          <p className="text-[10px] text-muted-foreground">
            {row.booksAtLine} book{row.booksAtLine === 1 ? "" : "s"}
            {row.otherLines > 0 && ` · +${row.otherLines} alt`}
          </p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        <PriceCell label="O" best={row.over} active={side === "over"} />
        <PriceCell label="U" best={row.under} active={side === "under"} />
      </div>

      <div className="mt-2 grid grid-cols-5 gap-1 border-t border-border pt-2">
        <RateCell label="L5" rate={row.hitRates.l5} />
        <RateCell label="L10" rate={row.hitRates.l10} />
        <RateCell label="L20" rate={row.hitRates.l20} />
        <RateCell label="Season" rate={row.hitRates.season} />
        <RateCell label={row.venue === "home" ? "Home" : row.venue === "away" ? "Away" : "Venue"} rate={row.hitRates.venue} />
      </div>
    </li>
  );
}

export default async function NbaPropsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const date = params.date && isValidEtDate(params.date) ? params.date : todayEt();
  const stat = (NBA_PROP_STAT_BY_KEY.has(params.stat as NbaPropStat) ? params.stat : "points") as NbaPropStat;
  const side: PropDirection = params.side === "under" ? "under" : "over";
  const sort: NbaPropSort = SORTS.some((s) => s.key === params.sort) ? (params.sort as NbaPropSort) : "hitRate";
  const current = { date, stat, side, sort, game: params.game };

  const [finder, freshness] = await Promise.all([
    getNbaPropsFinder({ dateEt: date, stat, side, sort, gameId: params.game }),
    getFeedFreshness("nbaProps"),
  ]);
  const statDef = NBA_PROP_STAT_BY_KEY.get(stat)!;

  return (
    <PageShell width="3xl">
      <PageHeader
        title="NBA Props"
        description={
          <>
            Best Over and Under across bettable books at the line most books hang, next to how often each player
            cleared it.{" "}
            <span className="text-muted-foreground/80">Hit rates are history, not a projection — no model EV.</span>
          </>
        }
        right={
          <Link href="/nba" className="text-xs text-muted-foreground underline underline-offset-2">
            Game lines →
          </Link>
        }
      />

      <DateNav basePath="/nba/props" date={date} extraQuery={`&stat=${stat}&side=${side}&sort=${sort}`} />

      <div className="mt-5 flex flex-wrap gap-1.5">
        {NBA_PROP_STATS.map((s) => (
          <Link key={s.key} href={hrefWith(current, { stat: s.key })} scroll={false} className={chipClass(s.key === stat)}>
            {s.shortLabel}
          </Link>
        ))}
      </div>

      {finder.games.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Link href={hrefWith(current, { game: "" })} scroll={false} className={chipClass(!params.game)}>
            All games
          </Link>
          {finder.games.map((g) => (
            <Link key={g.id} href={hrefWith(current, { game: g.id })} scroll={false} className={chipClass(params.game === g.id)}>
              {g.label}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <div className="inline-flex rounded-lg bg-muted p-0.5">
          {(["over", "under"] as const).map((s) => (
            <Link
              key={s}
              href={hrefWith(current, { side: s })}
              scroll={false}
              className={`rounded-md px-3 py-1 font-semibold ${s === side ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              {s === "over" ? "Over" : "Under"}
            </Link>
          ))}
        </div>
        <span className="text-muted-foreground">Sort:</span>
        {SORTS.map((s) => (
          <Link
            key={s.key}
            href={hrefWith(current, { sort: s.key })}
            scroll={false}
            className={s.key === sort ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {finder.rows.length === 0 ? (
        <div className="mt-8">
          <EmptyState title={`No ${statDef.label.toLowerCase()} props priced for this day`} freshness={freshness} arrow="miss" supportContext="nba-props-empty">
            Books post NBA props the morning of a game, and they come down at tip-off.
          </EmptyState>
        </div>
      ) : (
        <>
          <p className="mt-5 text-xs text-muted-foreground">
            {`${finder.rows.length} ${statDef.label.toLowerCase()} props · ${side === "over" ? "Over" : "Under"} hit rates at each player's consensus line`}
          </p>
          <ul className="mt-3 flex flex-col gap-2.5">
            {finder.rows.map((row) => (
              <PropCard key={row.key} row={row} side={side} statShort={statDef.shortLabel} />
            ))}
          </ul>
        </>
      )}
    </PageShell>
  );
}
