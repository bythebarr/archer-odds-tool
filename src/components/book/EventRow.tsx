import Link from "next/link";
import type { LeagueEventRow, EventTeam } from "@/lib/queries/lobby";
import type { TeamLeagueSport } from "@/lib/teamLeague/league";
import { Logo } from "@/components/Logo";
import { PriceButton } from "./PriceButton";

/** The shared grid template: team column, then Spread · Total · Moneyline. */
export const EVENT_GRID = "grid grid-cols-[minmax(0,1fr)_4.25rem_4.25rem_4.25rem] gap-1.5 sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_5.5rem]";

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function startLabel(iso: string, status: string): string {
  if (status === "live") return "LIVE";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(
    new Date(iso)
  );
}

/** Column labels, shown once above a list of rows. */
export function EventListHeader() {
  return (
    <div className={`${EVENT_GRID} px-3 pb-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground`}>
      <span />
      <span>Spread</span>
      <span>Total</span>
      <span>Money</span>
    </div>
  );
}

function TeamCell({ team, href }: { team: EventTeam; href: string }) {
  return (
    <Link href={href} className="flex min-w-0 items-center gap-2 pr-1">
      <Logo sources={[team.logoUrl]} alt={team.name} fallbackText={team.abbreviation} size={26} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold leading-tight text-foreground">{team.name.split(" ").slice(-1)[0]}</span>
        <span className="block text-[11px] leading-tight text-muted-foreground">{team.abbreviation}</span>
      </span>
    </Link>
  );
}

/**
 * One game as a sportsbook row: start time and an "All markets" link up top,
 * then away over home, each with its best Spread, Total and Moneyline. Team
 * names open the game; prices go to the Slip.
 */
export function EventRow({ event, sport }: { event: LeagueEventRow; sport: TeamLeagueSport }) {
  const matchLabel = `${event.away.abbreviation} @ ${event.home.abbreviation}`;
  const common = { sport, matchId: event.id, matchLabel } as const;
  const live = event.status === "live";
  return (
    <div className="rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between px-3 pb-1.5 pt-2.5 text-[11px]">
        <span className={live ? "font-bold text-red-600 dark:text-red-400" : "font-medium text-muted-foreground"}>
          {startLabel(event.startUtc, event.status)}
        </span>
        <Link href={event.href} className="font-semibold text-primary hover:underline">
          All markets ›
        </Link>
      </div>
      <div className="space-y-1.5 px-3 pb-3">
        {(["away", "home"] as const).map((side) => {
          const team = event[side];
          const spread = event.spread[side];
          const total = side === "away" ? event.total.over : event.total.under;
          const totalSide = side === "away" ? "over" : "under";
          return (
            <div key={side} className={`${EVENT_GRID} items-center`}>
              <TeamCell team={team} href={event.href} />
              <PriceButton
                {...common}
                price={spread}
                label={spread?.point != null ? signed(spread.point) : undefined}
                marketType="spreads"
                side={side}
                selectionLabel={`${team.name} ${spread?.point != null ? signed(spread.point) : ""}`.trim()}
              />
              <PriceButton
                {...common}
                price={total}
                label={total?.point != null ? `${side === "away" ? "O" : "U"} ${total.point}` : undefined}
                marketType="totals"
                side={totalSide}
                selectionLabel={`${side === "away" ? "Over" : "Under"} ${total?.point ?? ""}`.trim()}
              />
              <PriceButton
                {...common}
                price={event.moneyline[side]}
                marketType="h2h"
                side={side}
                selectionLabel={`${team.name} ML`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
