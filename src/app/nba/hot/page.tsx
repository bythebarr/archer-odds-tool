import type { Metadata } from "next";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { todayEt } from "@/lib/dateEt";
import { getLeagueDays } from "@/lib/queries/lobby";
import { getNbaPropsSlate, toWireSlate } from "@/lib/queries/nbaProps";
import { unpackLog, type GameLogPoint } from "@/lib/nba/propsMath";
import { nbaStandouts, MIN_CHANCE, type Standout } from "@/lib/nba/standouts";
import { NBA_PROP_STAT_BY_KEY } from "@/lib/nba/propStats";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { CANONICAL_NUMBERS, edgeFromChance } from "@/lib/propModel/canonical";
import { refreshOnView } from "@/lib/ops/refreshOnView";
import { SportCarousel } from "@/components/book/SportCarousel";
import { SportTabs } from "@/components/book/SportTabs";
import { LeagueHeader, leagueTabs } from "@/components/book/LeaguePage";
import { ScrollRow } from "@/components/ScrollRow";
import { EmptyState } from "@/components/EmptyState";

/** What the standout-adjusted read is, for the hover note. */
const STANDOUT_ADJUSTED_NOTE =
  "ARCHR chance with part of its gap from the book's no-vig chance taken off, as much as replayed nights say these picks overstate it. It ranks this page.";

export const metadata: Metadata = {
  title: "NBA — hottest props tonight",
  description: "Tonight's NBA players ARCHR expects to clear (or fall short of) their main line by the most, with the reasons and the alternate line worth a look.",
};

export const dynamic = "force-dynamic";

const SIDES = [
  { key: "", label: "Overs + unders" },
  { key: "over", label: "Overs" },
  { key: "under", label: "Unders" },
];
const STATS = ["points", "rebounds", "assists", "threes", "pointsReboundsAssists", "pointsRebounds", "pointsAssists", "reboundsAssists"];
const SHOWN = 40;

/** The day's standouts, kept five minutes (lineups, injuries and lines move through the day). */
const standoutsFor = unstable_cache(
  async (date: string): Promise<Standout[]> => {
    const slate = toWireSlate(await getNbaPropsSlate(date));
    const logs = Object.fromEntries(Object.entries(slate.logs).map(([id, l]) => [id, l.map(unpackLog)])) as Record<string, GameLogPoint[]>;
    return nbaStandouts(slate, logs);
  },
  ["nba-standouts"],
  { revalidate: 300 }
);

const pct = (x: number) => `${Math.round(x * 100)}%`;
const chip = (active: boolean) =>
  `shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${active ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`;
const rec = ([h, n]: [number, number]) => (n ? `${h}/${n}` : "—");

function startLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));
}

function Card({ s, rank }: { s: Standout; rank: number }) {
  const up = s.side === "over";
  const gap = s.projection - s.point;
  // EDGE comes from ARCHR chance only (lib/propModel/canonical), never from the adjusted read.
  const altEdge = s.alt ? edgeFromChance(s.alt.rawChance, s.alt.priceAmerican) : null;
  return (
    <li className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-start gap-3 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={s.headshotUrl} alt="" className="size-14 shrink-0 rounded-full bg-muted object-cover" loading="lazy" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            #{rank} · {s.team} vs {s.opponent} · {startLabel(s.startsAt)}
          </p>
          <Link href={`/nba/props?game=${s.gameId}`} className="block truncate text-base font-bold text-foreground hover:underline">
            {s.name}
          </Link>
          <p className="mt-0.5 text-sm">
            <span className={`font-extrabold ${up ? "text-emerald-600 dark:text-emerald-400" : "text-sky-600 dark:text-sky-400"}`}>
              {up ? "Over" : "Under"} {s.point} {s.statLabel}
            </span>
            {s.priceAmerican !== null && (
              <span className="ml-2 font-mono text-foreground">
                {formatAmerican(s.priceAmerican)}
                {s.bookName && <span className="ml-1 font-sans text-[10px] text-muted-foreground">{s.bookName}</span>}
              </span>
            )}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-2xl font-extrabold leading-none text-foreground">{s.projection.toFixed(1)}</p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{CANONICAL_NUMBERS.projection.shortLabel}</p>
          <p className={`mt-0.5 font-mono text-xs font-bold ${up ? "text-emerald-600 dark:text-emerald-400" : "text-sky-600 dark:text-sky-400"}`}>
            {gap >= 0 ? "+" : "−"}
            {Math.abs(gap).toFixed(1)} vs line
          </p>
          {s.minutes !== null && <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{s.minutes.toFixed(1)} min</p>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-px border-y border-border bg-border text-center sm:grid-cols-6">
        <div className="bg-card px-2 py-2" title={`${CANONICAL_NUMBERS.archrChance.blurb} Standout-adjusted: ${STANDOUT_ADJUSTED_NOTE}`}>
          <p className="font-mono text-sm font-bold text-foreground">{pct(s.rawChance)}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{CANONICAL_NUMBERS.archrChance.shortLabel}</p>
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">adj. {pct(s.chance)}</p>
        </div>
        {[
          ["L5", rec(s.hit.l5)],
          ["L10", rec(s.hit.l10)],
          ["Season", rec(s.hit.season)],
          [`vs ${s.opponent}`, rec(s.hit.h2h)],
          [`Like ${s.opponent}`, s.style ? rec([s.style.hits, s.style.games]) : "—"],
        ].map(([label, value]) => (
          <div key={label} className="bg-card px-2 py-2">
            <p className="font-mono text-sm font-bold text-foreground">{value}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      {s.reasons.length > 0 && (
        <ul className="space-y-1 px-3 pt-2.5 text-xs">
          {s.reasons.slice(0, 6).map((r) => (
            <li key={r.text} className="flex gap-2">
              <span
                aria-hidden
                className={`mt-0.5 w-3 shrink-0 text-center font-bold ${
                  r.supports === null ? "text-muted-foreground" : r.supports ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                }`}
              >
                {r.supports === null ? "•" : r.supports ? "▲" : "▼"}
              </span>
              <span className={r.supports === null ? "text-muted-foreground" : "text-foreground"}>{r.text}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3 pt-2.5">
        {s.alt ? (
          <p className="rounded-lg bg-muted px-2.5 py-1.5 text-xs text-foreground">
            <span className="font-semibold">Alt line:</span> {up ? "Over" : "Under"} {s.alt.point} {s.statLabel}{" "}
            <span className="font-mono font-bold">{formatAmerican(s.alt.priceAmerican)}</span>
            <span className="text-muted-foreground">
              {" "}
              · {CANONICAL_NUMBERS.archrChance.shortLabel} {pct(s.alt.rawChance)} (adj. {pct(s.alt.chance)}) · L10 {rec(s.alt.l10)}
              {altEdge !== null && (
                <>
                  {" "}
                  · {CANONICAL_NUMBERS.edge.shortLabel} {altEdge >= 0 ? "+" : "−"}
                  {Math.abs(altEdge * 100).toFixed(0)}%
                </>
              )}
            </span>
          </p>
        ) : (
          <span />
        )}
        <Link href={`/nba/props?game=${s.gameId}`} className="text-xs font-semibold text-foreground underline-offset-2 hover:underline">
          Every line and game →
        </Link>
      </div>
    </li>
  );
}

/**
 * Hottest tonight: the NBA props ARCHR expects to clear their main line by the
 * most, or to fall furthest short of it (lib/nba/standouts), with the reasons
 * behind each call and the alternate line worth a look.
 */
export default async function NbaHotPage({ searchParams }: { searchParams: Promise<{ side?: string; stat?: string }> }) {
  const params = await searchParams;
  await refreshOnView([["sync-injuries", 20], ["espn-props", 30], ["espn-odds", 30]]);
  const days = await getLeagueDays("nba", todayEt());
  const date = days[0] ?? todayEt();
  const all = await standoutsFor(date);
  const side = params.side === "over" || params.side === "under" ? params.side : "";
  const stat = params.stat && STATS.includes(params.stat) ? params.stat : "";
  const shown = all.filter((s) => (!side || s.side === side) && (!stat || s.stat === stat));
  const href = (change: { side?: string; stat?: string }) => {
    const qs = new URLSearchParams(Object.entries({ side, stat, ...change }).filter(([, v]) => v) as [string, string][]).toString();
    return qs ? `/nba/hot?${qs}` : "/nba/hot";
  };

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-24 pt-5 font-sans">
      <SportCarousel active="nba" />
      <LeagueHeader sport="nba" />
      <div className="mt-3">
        <SportTabs tabs={leagueTabs("nba", "hot")} />
      </div>
      <h2 className="mt-5 font-display text-2xl font-extrabold uppercase italic leading-none tracking-tight text-foreground">Hottest tonight</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        The players ARCHR sees blowing past their main line, or falling well short of it, and why.
      </p>

      <ScrollRow className="-mx-4 mt-3 flex gap-2 px-4 pb-1">
        {SIDES.map((x) => (
          <Link key={x.key} scroll={false} href={href({ side: x.key })} className={chip(side === x.key)}>
            {x.label}
          </Link>
        ))}
      </ScrollRow>
      <ScrollRow className="-mx-4 mt-2 flex gap-2 px-4 pb-1">
        <Link scroll={false} href={href({ stat: "" })} className={chip(!stat)}>
          All stats
        </Link>
        {STATS.map((k) => (
          <Link key={k} scroll={false} href={href({ stat: k })} className={chip(stat === k)}>
            {NBA_PROP_STAT_BY_KEY.get(k as never)?.shortLabel ?? k}
          </Link>
        ))}
      </ScrollRow>

      {shown.length === 0 ? (
        <div className="mt-8">
          <EmptyState title={all.length ? "Nothing stands out with these filters" : "No standouts yet"}>
            {all.length
              ? "Try all stats, or both overs and unders."
              : "They show once books post tonight's NBA props and ARCHR sees a player well clear of his line."}
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {shown.slice(0, SHOWN).map((s, i) => (
            <Card key={`${s.playerId}:${s.stat}`} s={s} rank={i + 1} />
          ))}
        </ul>
      )}

      <p className="mt-5 text-[11px] leading-relaxed text-muted-foreground">
        A call makes the page when ARCHR&apos;s projection sits well clear of the main line, measured in the player&apos;s own game-to-game spread
        for that stat (a 3-point gap counts for more on a 12-point scorer than on a 30-point one), its chance on that side is at least{" "}
        {pct(MIN_CHANCE)}, and his last-10 record doesn&apos;t flatly disagree. ARCHR chance is the same
        number every props page shows for the prop. Calls are ranked by its standout-adjusted read (&ldquo;adj.&rdquo;): the biggest
        disagreements with the book are also where a projection is most often wrong, so the adjusted read keeps only part of ARCHR&apos;s edge
        over the book&apos;s own, the part that held up when past nights were replayed — on these picks it has graded closer to what happened. The reasons (▲ for the call, ▼ against) are the
        projection&apos;s own inputs: his minutes (teammates out, rest, a return, tonight&apos;s lineup, blowout risk), what the opponent allows to
        his position, the game total and his recent form. Records (•) are context: against this opponent, at this venue, and against teams that
        play like it (&ldquo;Like&rdquo;: the five teams closest to the opponent in pace and in what they allow, his position included). The
        alternate line is the rung beyond the main line with the best value at the adjusted read; its edge is ARCHR edge, the price at ARCHR
        chance, as everywhere. Research only.
      </p>
    </div>
  );
}
