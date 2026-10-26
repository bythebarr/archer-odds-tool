import Link from "next/link";
import type { UfcBoutCorner, UfcBoutSummary, UfcEventSummary } from "@/lib/queries/ufcEvents";
import { BOOK_NAMES } from "@/lib/odds/bookAllowlist";
import { FighterBadge } from "@/components/FighterBadge";
import { RED_CORNER, BLUE_CORNER } from "@/components/ufc/UfcWinProbabilityCard";
import { PriceButton } from "./PriceButton";

/** Cito event dates are date-only values at UTC midnight — format in UTC so they don't roll back a day in ET. */
export function formatFightDate(date: Date, withYear = false): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(date);
}

function CornerRow({
  corner,
  color,
  bout,
  upcoming,
  matchLabel,
}: {
  corner: UfcBoutCorner;
  color: string;
  bout: UfcBoutSummary;
  upcoming: boolean;
  matchLabel: string;
}) {
  const won = bout.winnerFighterId === corner.id;
  const lost = !upcoming && bout.winnerFighterId !== null && !won;
  return (
    <div className="flex items-center gap-2.5">
      <span className="relative shrink-0">
        <FighterBadge name={corner.name} imageUrl={corner.imageUrl} size={40} />
        {/* Corner stripe: red or blue, the way a broadcast marks the fighters. */}
        <span className="absolute -left-1 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full" style={{ background: color }} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-[14px] font-semibold leading-tight ${lost ? "text-muted-foreground" : "text-foreground"}`}>
          {corner.name}
          {won && <span className="ml-1.5 rounded bg-brand px-1 py-px text-[9px] font-bold uppercase text-brand-foreground">Win</span>}
        </p>
        <p className="text-[11px] text-muted-foreground">{corner.record ?? "—"}</p>
      </div>
      {upcoming && (
        <div className="w-[4.75rem] shrink-0">
          <PriceButton
            price={corner.best ? { point: null, ...corner.best, bookName: BOOK_NAMES[corner.best.bookKey] ?? corner.best.bookKey } : null}
            sport="ufc"
            matchId={bout.id}
            matchLabel={matchLabel}
            marketType="h2h"
            side={corner.id === bout.red.id ? "red" : "blue"}
            selectionLabel={`${corner.name} ML`}
          />
        </div>
      )}
    </div>
  );
}

/** One bout as a sportsbook row: both corners with photos and records, each with its best moneyline. */
export function UfcBoutRow({ bout, upcoming }: { bout: UfcBoutSummary; upcoming: boolean }) {
  const matchLabel = `${bout.red.name} vs ${bout.blue.name}`;
  const rounds = bout.isMainEvent || bout.titleBout ? 5 : 3;
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {bout.titleBout && <span className="rounded bg-amber-500/15 px-1.5 py-px text-amber-700 dark:text-amber-300">Title</span>}
          {bout.isMainEvent && <span className="text-foreground">Main event ·</span>}
          {bout.weightClass} · {rounds} rds
          {!upcoming && bout.method ? ` · ${bout.method}${bout.resultRound ? ` R${bout.resultRound}` : ""}` : ""}
        </p>
        <Link href={`/ufc/${bout.id}`} className="shrink-0 text-xs font-semibold text-primary hover:underline">
          Matchup ›
        </Link>
      </div>
      <div className="flex flex-col gap-2">
        <CornerRow corner={bout.red} color={RED_CORNER} bout={bout} upcoming={upcoming} matchLabel={matchLabel} />
        <CornerRow corner={bout.blue} color={BLUE_CORNER} bout={bout} upcoming={upcoming} matchLabel={matchLabel} />
      </div>
    </div>
  );
}

const SECTION_ORDER = ["Main Card", "Prelims", "Early Prelims"];

/** A card's bouts grouped into Main Card / Prelims / Early Prelims when the feed says, else one list. */
export function UfcCardSections({ event, upcoming, limit }: { event: UfcEventSummary; upcoming: boolean; limit?: number }) {
  const bouts = limit ? event.bouts.slice(0, limit) : event.bouts;
  const groups = new Map<string, UfcBoutSummary[]>();
  for (const b of bouts) {
    const key = b.cardSection ?? "";
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a);
    const ib = SECTION_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return (
    <div className="flex flex-col gap-5">
      {keys.map((key) => (
        <section key={key || "card"}>
          {key && (
            <h3 className="mb-2 flex items-center gap-2 font-display text-sm font-extrabold uppercase italic tracking-wide text-foreground">
              <span className="brand-slash" aria-hidden />
              {key}
            </h3>
          )}
          {upcoming && (
            <div className="mb-1.5 flex justify-end pr-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span className="w-[4.75rem] text-center">Money</span>
            </div>
          )}
          <div className="flex flex-col gap-2.5">
            {groups.get(key)!.map((b) => (
              <UfcBoutRow key={b.id} bout={b} upcoming={upcoming} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The card's banner: always ink, the headliners' photos facing off over the mark. */
export function UfcEventHero({ event }: { event: UfcEventSummary }) {
  const main = event.bouts.find((b) => b.isMainEvent) ?? event.bouts[0];
  return (
    <div className="relative overflow-hidden rounded-2xl bg-[#07080b] bg-[radial-gradient(110%_90%_at_50%_120%,rgba(200,245,58,0.14),transparent_60%)] px-5 pb-5 pt-4 text-[#eef0f4] ring-1 ring-white/10">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a90a0]">
        <span className="brand-slash" aria-hidden />
        {formatFightDate(event.eventDate)}
        {event.location ? ` · ${event.location}` : ""}
      </p>
      <h2 className="mt-1.5 font-display text-2xl font-extrabold uppercase italic leading-tight tracking-tight">{event.title}</h2>
      {main && (
        <div className="mt-4 flex items-center justify-between gap-3">
          {[main.red, main.blue].map((c, i) => (
            <div key={c.id} className={`flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center ${i === 1 ? "order-3" : ""}`}>
              <span className="rounded-full p-[3px]" style={{ background: i === 0 ? RED_CORNER : BLUE_CORNER }}>
                <FighterBadge name={c.name} imageUrl={c.imageUrl} size={72} />
              </span>
              <span className="w-full truncate text-sm font-semibold">{c.name}</span>
              <span className="text-[11px] text-[#8a90a0]">{c.record ?? ""}</span>
            </div>
          ))}
          <span className="order-2 font-display text-xl font-extrabold italic text-[#c8f53a]">VS</span>
        </div>
      )}
      <p className="mt-3 text-center text-[11px] text-[#8a90a0]">
        {event.bouts.length} {event.bouts.length === 1 ? "fight" : "fights"}
        {main?.titleBout ? " · title fight headliner" : ""}
      </p>
    </div>
  );
}
