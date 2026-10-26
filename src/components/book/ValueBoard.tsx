import Link from "next/link";
import type { MarketType } from "@/generated/prisma/client";
import { getLeagueDays, getLeagueEvents, type EventPrice } from "@/lib/queries/lobby";
import { getValueNbaProps } from "@/lib/queries/nbaProps";
import { getValueNflProps } from "@/lib/queries/nflProps";
import { listUpcomingUfcEvents } from "@/lib/queries/ufcEvents";
import { EV_FLAG } from "@/lib/odds/marketValue";
import { BOOK_NAMES } from "@/lib/odds/bookAllowlist";
import { formatAmerican } from "@/lib/odds/americanOdds";
import type { SlipSport } from "@/lib/slip/SlipContext";
import type { TeamLeagueSport } from "@/lib/teamLeague/league";
import { Glyph, type GlyphKey } from "@/components/brand/Glyph";
import { BookBadge } from "@/components/BookBadge";
import { EvTag } from "@/components/EvTag";
import { PriceButton } from "./PriceButton";

/** One flagged price on the board: a game line or moneyline that goes straight to the slip, or a prop that opens its sheet. */
type ValuePlay =
  | {
      kind: "line";
      key: string;
      sport: SlipSport & GlyphKey;
      label: string;
      sub: string;
      price: EventPrice;
      buttonLabel?: string;
      matchId: string;
      matchLabel: string;
      marketType: MarketType;
      side: string;
      ev: number;
    }
  | { kind: "prop"; key: string; label: string; sub: string; href: string; price: number; bookKey: string; ev: number; fairAmerican: number; booksUsed: number };

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

async function linePlays(sport: TeamLeagueSport, today: string): Promise<ValuePlay[]> {
  const [day] = await getLeagueDays(sport, today);
  if (!day) return [];
  const out: ValuePlay[] = [];
  for (const e of await getLeagueEvents(sport, day)) {
    const matchLabel = `${e.away.abbreviation} @ ${e.home.abbreviation}`;
    const add = (price: EventPrice | null, marketType: MarketType, side: string, label: string, buttonLabel?: string) => {
      if (price?.value && price.value.ev >= EV_FLAG) {
        out.push({ kind: "line", key: `${e.id}:${marketType}:${side}`, sport, label, sub: matchLabel, price, buttonLabel, matchId: e.id, matchLabel, marketType, side, ev: price.value.ev });
      }
    };
    for (const side of ["away", "home"] as const) {
      const team = e[side];
      const sp = e.spread[side];
      if (sp?.point != null) add(sp, "spreads", side, `${team.name} ${signed(sp.point)}`, signed(sp.point));
      add(e.moneyline[side], "h2h", side, `${team.name} ML`);
    }
    const o = e.total.over;
    const u = e.total.under;
    if (o?.point != null) add(o, "totals", "over", `Over ${o.point}`, `O ${o.point}`);
    if (u?.point != null) add(u, "totals", "under", `Under ${u.point}`, `U ${u.point}`);
  }
  return out;
}

async function ufcPlays(): Promise<ValuePlay[]> {
  const [event] = await listUpcomingUfcEvents(1);
  if (!event) return [];
  return event.bouts.flatMap((b) =>
    [b.red, b.blue].flatMap((c): ValuePlay[] => {
      const best = c.best;
      if (!best?.value || best.value.ev < EV_FLAG) return [];
      return [
        {
          kind: "line",
          key: `${b.id}:${c.id}`,
          sport: "ufc",
          label: `${c.name} ML`,
          sub: `${b.red.name} vs ${b.blue.name}`,
          price: { point: null, ...best, bookName: BOOK_NAMES[best.bookKey] ?? best.bookKey },
          matchId: b.id,
          matchLabel: `${b.red.name} vs ${b.blue.name}`,
          marketType: "h2h",
          side: c.id === b.red.id ? "red" : "blue",
          ev: best.value.ev,
        },
      ];
    })
  );
}

/**
 * The lobby's value board: every price on today's slates — NBA and NFL lines,
 * NBA and NFL props, the next UFC card — that beats the rest of the market's fair
 * (no-vig) price by more than the noise floor, biggest edge first. A market
 * read, not a model pick: it says a price is better than where the books
 * collectively put it.
 */
export async function ValueBoard({ today, limit = 8 }: { today: string; limit?: number }) {
  const [nbaDay] = await getLeagueDays("nba", today);
  const [nba, nfl, ufc, props, nflProps] = await Promise.all([
    linePlays("nba", today),
    linePlays("nfl", today),
    ufcPlays(),
    nbaDay ? getValueNbaProps(nbaDay, limit) : Promise.resolve([]),
    getValueNflProps(limit),
  ]);
  const plays: ValuePlay[] = [
    ...nba,
    ...nfl,
    ...ufc,
    ...props.map(
      (p): ValuePlay => ({
        kind: "prop",
        key: `${p.playerId}:${p.stat}:${p.side}`,
        label: `${p.playerName} ${p.side === "over" ? "O" : "U"} ${p.point} ${p.statShort}`,
        sub: `${p.matchup} · ${p.hits}/${p.sample} L10`,
        href: `/nba/${p.gameId}?tab=props&stat=${p.stat}&side=${p.side}`,
        price: p.priceAmerican,
        bookKey: p.bookKey,
        ev: p.ev,
        fairAmerican: p.fairAmerican,
        booksUsed: p.booksUsed,
      })
    ),
    ...nflProps.map((p): ValuePlay => ({ kind: "prop", ...p })),
  ]
    .sort((a, b) => b.ev - a.ev)
    .slice(0, limit);

  if (plays.length === 0) return null;
  return (
    <section>
      <div className="mb-2.5 flex items-end justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex size-6 items-center justify-center rounded-md bg-brand font-display text-xs font-extrabold italic text-brand-foreground">
            EV
          </span>
          <div>
            <h2 className="font-display text-xl font-extrabold uppercase italic leading-none tracking-tight text-foreground">Best value</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">Prices beating the market&apos;s no-vig fair price</p>
          </div>
        </div>
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {plays.map((p) => (
          <li key={p.key} className="flex items-center gap-3 px-3 py-2.5">
            <Glyph name={p.kind === "prop" ? "props" : p.sport} className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-foreground">{p.label}</p>
              <p className="truncate text-[11px] text-muted-foreground">{p.sub}</p>
            </div>
            {p.kind === "line" ? (
              <div className="w-[4.75rem] shrink-0 pt-1.5">
                <PriceButton
                  price={p.price}
                  label={p.buttonLabel}
                  sport={p.sport}
                  matchId={p.matchId}
                  matchLabel={p.matchLabel}
                  marketType={p.marketType}
                  side={p.side}
                  selectionLabel={p.label}
                />
              </div>
            ) : (
              <Link href={p.href} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-muted px-2 py-1.5 hover:bg-muted-foreground/15">
                <EvTag value={{ ev: p.ev, fairAmerican: p.fairAmerican, booksUsed: p.booksUsed }} />
                <span className="font-mono text-[13px] font-semibold text-foreground">{formatAmerican(p.price)}</span>
                <BookBadge bookKey={p.bookKey} bookName={BOOK_NAMES[p.bookKey] ?? p.bookKey} size={18} />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
