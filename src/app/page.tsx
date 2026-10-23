import Link from "next/link";
import { getLeagueDays, getLeagueEvents } from "@/lib/queries/lobby";
import { getTopNbaProps } from "@/lib/queries/nbaProps";
import { listUpcomingUfcEvents } from "@/lib/queries/ufcEvents";
import { refreshUpcomingUfcOnView } from "@/lib/ufc/refreshUpcoming";
import { todayEt, formatEtDateLabel } from "@/lib/dateEt";
import { sportMetaByKey } from "@/lib/engine/sportsMeta";
import type { TeamLeagueSport } from "@/lib/teamLeague/league";
import { SportCarousel } from "@/components/book/SportCarousel";
import { EventListHeader, EventRow } from "@/components/book/EventRow";
import { TopPropsStrip } from "@/components/book/TopPropsStrip";
import { UfcCard } from "@/components/book/UfcCard";
import { NewHerePrimer } from "@/components/dashboard/NewHerePrimer";

// The lobby follows the day's games and lines — render per request.
export const dynamic = "force-dynamic";

/** How many games a sport shows in the lobby before "See all". */
const LOBBY_GAMES = 4;

function SectionHeader({ icon, title, subtitle, href, cta }: { icon: string; title: string; subtitle?: string; href: string; cta: string }) {
  return (
    <div className="mb-2.5 flex items-end justify-between">
      <div className="flex items-center gap-2">
        <span className="text-xl" aria-hidden>
          {icon}
        </span>
        <div>
          <h2 className="text-lg font-bold leading-tight tracking-tight text-foreground">{title}</h2>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      <Link href={href} className="text-sm font-semibold text-primary hover:underline">
        {cta} ›
      </Link>
    </div>
  );
}

function dayName(dateEt: string, today: string): string {
  if (dateEt === today) return "Today";
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${dateEt}T12:00:00Z`)
  );
}

/** A league's next game day in the lobby: its first few games, then See all. */
async function LeagueSection({ sport, today }: { sport: TeamLeagueSport; today: string }) {
  const [day] = await getLeagueDays(sport, today);
  if (!day) return null;
  const events = await getLeagueEvents(sport, day);
  if (events.length === 0) return null;
  const meta = sportMetaByKey[sport];
  return (
    <section>
      <SectionHeader
        icon={meta.icon}
        title={meta.label}
        subtitle={`${dayName(day, today)} · ${events.length} ${events.length === 1 ? "game" : "games"}`}
        href={`/${sport}?date=${day}`}
        cta="See all"
      />
      <EventListHeader />
      <div className="flex flex-col gap-2.5">
        {events.slice(0, LOBBY_GAMES).map((e) => (
          <EventRow key={e.id} event={e} sport={sport} />
        ))}
      </div>
    </section>
  );
}

async function NbaPropsSection({ today }: { today: string }) {
  const [day] = await getLeagueDays("nba", today);
  const props = day ? await getTopNbaProps(day) : [];
  if (props.length === 0) return null;
  return (
    <section>
      <SectionHeader icon="🎯" title="Top NBA props" subtitle="Cleared the line in 8+ of the last 10" href={`/nba/props?date=${day}`} cta="All props" />
      <TopPropsStrip props={props} />
    </section>
  );
}

async function UfcSection() {
  const [event] = await listUpcomingUfcEvents(1);
  if (!event || event.bouts.length === 0) return null;
  return (
    <section>
      <SectionHeader icon="🥊" title="UFC" subtitle="Next card" href="/ufc" cta="Full card" />
      <UfcCard event={event} limit={5} />
    </section>
  );
}

/**
 * The lobby: a sport switcher, then each in-season sport's next slate as
 * sportsbook rows — the best price on every line, one tap from every market.
 */
export default async function Home() {
  // The lobby shows the UFC card, so keep the upcoming feed fresh on view.
  refreshUpcomingUfcOnView();
  const today = todayEt();

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-10 pt-5 font-sans">
      <SportCarousel />
      <div className="mt-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{formatEtDateLabel(today)}</p>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Best lines, every book</h1>
      </div>

      <div className="mt-6 flex flex-col gap-8">
        <LeagueSection sport="nba" today={today} />
        <NbaPropsSection today={today} />
        <LeagueSection sport="nfl" today={today} />
        <UfcSection />
      </div>

      <div className="mt-8">
        <NewHerePrimer />
      </div>
    </div>
  );
}
