import type { Metadata } from "next";
import Link from "next/link";
import { SportCarousel } from "@/components/book/SportCarousel";
import { propBoardEvents, propBoardFor, propBoardLeagues } from "@/lib/queries/propBoard";
import { formatAmerican } from "@/lib/odds/americanOdds";
import type { BoardMarket, BoardPrice } from "@/lib/props/propBoard";
import { refreshOnView } from "@/lib/ops/refreshOnView";

export const metadata: Metadata = {
  title: "Book prop lines — every league",
  description: "Every player prop line the books hang, main lines and alt ladders, for every league with props: NHL, soccer, college and more.",
};

export const dynamic = "force-dynamic";

const PERIOD_LABEL: Record<string, string> = { game: "", h1: "1st half", h2: "2nd half", q1: "1st qtr", q2: "2nd qtr", q3: "3rd qtr", q4: "4th qtr", p1: "1st period", p2: "2nd period", p3: "3rd period" };
const chip = (active: boolean) =>
  `shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${active ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`;

const price = (p: BoardPrice[]) => {
  const best = p.filter((x) => x.priceAmerican !== null).sort((a, b) => b.priceAmerican! - a.priceAmerican!)[0];
  return best ? formatAmerican(best.priceAmerican!) : "no price yet";
};

function startLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));
}

function Market({ m }: { m: BoardMarket }) {
  return (
    <div className="py-2">
      <p className="text-xs font-semibold text-foreground">
        {m.title}
        {PERIOD_LABEL[m.period] ? <span className="ml-1 font-normal text-muted-foreground">· {PERIOD_LABEL[m.period]}</span> : null}
      </p>
      {m.lines.map((l) => (
        <p key={l.point} className="mt-0.5 font-mono text-xs text-muted-foreground">
          O {l.point} <span className="text-foreground">{price(l.over)}</span> · U {l.point} <span className="text-foreground">{price(l.under)}</span>
        </p>
      ))}
      {m.yes.length > 0 && <p className="mt-0.5 font-mono text-xs text-muted-foreground">Yes <span className="text-foreground">{price(m.yes)}</span></p>}
      {m.ladder.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {m.ladder.map((r) => (
            <span key={r.point} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {r.point + 0.5}+ <span className="text-foreground">{price(r.prices)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Every prop line the books hang for leagues ARCHR doesn't model player by
 * player yet (NHL, MLS, college, UFC when listed) — and the rest too: the main
 * Over/Under, the alt ladder and Yes props, per player.
 */
export default async function PropLinesPage({ searchParams }: { searchParams: Promise<{ league?: string; event?: string }> }) {
  const params = await searchParams;
  await refreshOnView([["espn-props", 30]]);
  const leagues = await propBoardLeagues();
  const league = leagues.find((l) => l.path === params.league) ?? leagues[0] ?? null;
  const events = league ? await propBoardEvents(league.path) : [];
  const event = events.find((e) => e.espnEventId === params.event) ?? events[0] ?? null;
  const players = event ? await propBoardFor(event.espnEventId) : [];
  const href = (q: Record<string, string>) => `/player-props/lines?${new URLSearchParams(q).toString()}`;

  return (
    <div className="mx-auto min-h-screen w-full min-w-0 max-w-2xl px-4 pb-10 pt-5 font-sans">
      <SportCarousel active="all" />
      <h1 className="mt-5 font-display text-3xl font-extrabold uppercase italic leading-none tracking-tight text-foreground">Book prop lines</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Every player prop the books hang, main line and alt ladder, from DraftKings today. More books land here as more feeds come on.{" "}
        <Link href="/player-props" className="font-semibold text-foreground underline-offset-2 hover:underline">
          Modeled props →
        </Link>
      </p>

      {!league ? (
        <p className="mt-8 rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">No book has prop lines up for the next few days yet.</p>
      ) : (
        <>
          <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {leagues.map((l) => (
              <Link key={l.path} href={href({ league: l.path })} className={chip(l.path === league.path)}>
                {l.name} <span className="opacity-60">{l.events}</span>
              </Link>
            ))}
          </div>
          <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {events.map((e) => (
              <Link key={e.espnEventId} href={href({ league: league.path, event: e.espnEventId })} className={chip(e.espnEventId === event?.espnEventId)}>
                {e.label} <span className="font-normal opacity-60">{startLabel(e.startsAt)}</span>
              </Link>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {players.length} players · {event?.lines ?? 0} lines · tap a player for every market
          </p>
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
            {players.map((p) => (
              <li key={p.athleteId}>
                <details className="group px-3 py-2">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">{p.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {p.markets.length} {p.markets.length === 1 ? "market" : "markets"} <span className="inline-block transition-transform group-open:rotate-90">›</span>
                    </span>
                  </summary>
                  <div className="divide-y divide-border">
                    {p.markets.map((m) => (
                      <Market key={`${m.title}|${m.period}`} m={m} />
                    ))}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
