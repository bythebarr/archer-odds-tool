import Link from "next/link";
import type { BoardEvent, BoardSide } from "@/lib/queries/allSports";
import type { EventPrice } from "@/lib/queries/lobby";
import { PriceButton } from "@/components/book/PriceButton";
import { Logo } from "@/components/Logo";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** A board price as the shared PriceButton wants it, ARCHR's edge as its value read. */
function asPrice(s: BoardSide | null): EventPrice | null {
  if (!s) return null;
  return {
    point: s.point,
    priceAmerican: s.priceAmerican,
    bookKey: s.bookKey,
    bookName: s.bookName,
    value: s.ev !== null && s.fairAmerican !== null ? { ev: s.ev, fairAmerican: s.fairAmerican, booksUsed: 0 } : null,
  };
}

function startLabel(d: Date, status: string): string {
  if (status === "live") return "LIVE";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const fmt = new Intl.DateTimeFormat("en-US", sameDay ? { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" } : { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  return fmt.format(d);
}

function Team({ name, logo, href, score }: { name: string; logo: string; href: string; score: number | null }) {
  return (
    <Link href={href} className="flex min-w-0 items-center gap-2 pr-1">
      <Logo sources={[logo]} alt={name} fallbackText={initials(name)} size={26} />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-tight text-foreground">{name}</span>
      {score !== null && <span className="font-mono text-sm font-bold text-foreground">{score}</span>}
    </Link>
  );
}

const signedLine = (x: number) => (x === 0 ? "PK" : x > 0 ? `+${x}` : `−${Math.abs(x)}`);
const american = (x: number) => (x > 0 ? `+${x}` : `${x}`);

/**
 * A price cell before any book posts: ARCHR's own number from the model,
 * dashed and labeled so it never reads as a bettable price. Taps open the breakdown.
 */
function ArchrCell({ href, top, value }: { href: string; top?: string; value: string | null }) {
  if (value === null) {
    return <div className="flex h-12 items-center justify-center rounded-lg bg-muted/50 text-xs text-muted-foreground/60">—</div>;
  }
  return (
    <Link href={href} className="flex h-12 flex-col items-center justify-center rounded-lg border border-dashed border-brand/50 bg-brand/5 px-1 text-center hover:bg-brand/10">
      <span className="text-[9px] font-bold uppercase leading-none tracking-wide text-muted-foreground">{top ?? "ARCHR"}</span>
      <span className="mt-0.5 font-mono text-[13px] font-semibold leading-tight text-foreground">{value}</span>
    </Link>
  );
}

export const TWO_WAY_GRID = "grid grid-cols-[minmax(0,1fr)_4.25rem_4.25rem_4.25rem] gap-1.5 sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_5.5rem]";
/** Sports with no handicap posted (most one-on-one matches): total and money only, more room for names. */
export const NO_SPREAD_GRID = "grid grid-cols-[minmax(0,1fr)_4.6rem_4.6rem] gap-1.5 sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem]";
export const THREE_WAY_GRID = "grid grid-cols-[minmax(0,1fr)_3.9rem_3.9rem_3.9rem] gap-1.5 sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_5.5rem]";

/** Column labels for a list of rows. */
export function AllSportListHeader({ threeWay, noSpread = false }: { threeWay: boolean; noSpread?: boolean }) {
  return (
    <div className={`${threeWay ? THREE_WAY_GRID : noSpread ? NO_SPREAD_GRID : TWO_WAY_GRID} px-3 pb-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground`}>
      <span />
      {(threeWay ? ["1", "X", "2"] : noSpread ? ["Total", "Money"] : ["Spread", "Total", "Money"]).map((h) => (
        <span key={h}>{h}</span>
      ))}
    </div>
  );
}

/**
 * One game on an all-sports board. Two-way sports read like the NBA board
 * (away over home: spread, total, money); three-way sports (soccer) list home
 * first with 1 · X · 2. Prices go to the Slip; names open the full breakdown.
 */
export function AllSportEventRow({ event, sport, threeWay, noSpread = false }: { event: BoardEvent; sport: string; threeWay: boolean; noSpread?: boolean }) {
  const href = `/sports/${sport}/event/${encodeURIComponent(event.id)}`;
  const matchLabel = threeWay ? `${event.home} v ${event.away}` : `${event.away} @ ${event.home}`;
  const common = { sport: "all" as const, matchId: event.id, matchLabel };
  const live = event.status === "live";
  // No book has posted: ARCHR's own prices hold the cells until one does.
  const priced = event.ml.home !== null || event.ml.away !== null || event.spread.home !== null || event.total.over !== null;
  const a = event.archr;
  const head = (
    <div className="flex items-center justify-between px-3 pb-1.5 pt-2.5 text-[11px]">
      <span className={live ? "font-bold text-red-600 dark:text-red-400" : "font-medium text-muted-foreground"}>{startLabel(event.startsAt, event.status)}</span>
      <Link href={href} className="font-semibold text-primary hover:underline">
        {!priced ? "ARCHR prices · books soon" : event.markets > 3 ? `${event.markets} markets` : "Breakdown"} ›
      </Link>
    </div>
  );

  if (threeWay) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {head}
        <div className={`${THREE_WAY_GRID} items-center px-3 pb-3`}>
          <div className="space-y-2">
            <Team name={event.home} logo={event.homeLogo} href={href} score={event.homeScore} />
            <Team name={event.away} logo={event.awayLogo} href={href} score={event.awayScore} />
          </div>
          {priced ? (
            <>
              <PriceButton {...common} price={asPrice(event.ml.home)} marketType="h2h" side="home" selectionLabel={`${event.home} to win`} />
              <PriceButton {...common} price={asPrice(event.ml.draw)} marketType="h2h" side="draw" selectionLabel="Draw" />
              <PriceButton {...common} price={asPrice(event.ml.away)} marketType="h2h" side="away" selectionLabel={`${event.away} to win`} />
            </>
          ) : (
            <>
              <ArchrCell href={href} value={a ? american(a.fair.home) : null} />
              <ArchrCell href={href} value={a?.fair.draw != null ? american(a.fair.draw) : null} />
              <ArchrCell href={href} value={a ? american(a.fair.away) : null} />
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {head}
      <div className="space-y-1.5 px-3 pb-3">
        {(["away", "home"] as const).map((side) => {
          const name = event[side];
          const spread = event.spread[side];
          const total = side === "away" ? event.total.over : event.total.under;
          return (
            <div key={side} className={`${noSpread ? NO_SPREAD_GRID : TWO_WAY_GRID} items-center`}>
              <Team name={name} logo={side === "home" ? event.homeLogo : event.awayLogo} href={href} score={side === "home" ? event.homeScore : event.awayScore} />
              {priced ? (
                <>
                  {!noSpread && <PriceButton {...common} price={asPrice(spread)} label={spread?.label} marketType="spreads" side={side} selectionLabel={`${name} ${spread?.label ?? ""}`.trim()} />}
                  <PriceButton {...common} price={asPrice(total)} label={total?.label} marketType="totals" side={side === "away" ? "over" : "under"} selectionLabel={total ? `${total.label.startsWith("O") ? "Over" : "Under"} ${total.point}` : "Total"} />
                  <PriceButton {...common} price={asPrice(event.ml[side])} marketType="h2h" side={side} selectionLabel={`${name} ML`} />
                </>
              ) : (
                <>
                  {!noSpread && <ArchrCell href={href} value={a?.spread != null ? signedLine(side === "home" ? a.spread : -a.spread) : null} />}
                  <ArchrCell href={href} top={side === "away" ? "ARCHR O" : "ARCHR U"} value={a?.total != null ? `${a.total}` : null} />
                  <ArchrCell href={href} value={a ? american(side === "home" ? a.fair.home : a.fair.away) : null} />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
