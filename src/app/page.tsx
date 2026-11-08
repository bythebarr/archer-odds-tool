import Link from "next/link";
import { Suspense } from "react";
import { getLeagueDays, getLeagueEvents } from "@/lib/queries/lobby";
import { getTopNbaProps } from "@/lib/queries/nbaProps";
import { listUpcomingUfcEvents } from "@/lib/queries/ufcEvents";
import { refreshUpcomingUfcOnView } from "@/lib/ufc/refreshUpcoming";
import { todayEt, formatEtDateLabel } from "@/lib/dateEt";
import { sportMetaByKey } from "@/lib/engine/sportsMeta";
import type { TeamLeagueSport } from "@/lib/teamLeague/league";
import { SportCarousel } from "@/components/book/SportCarousel";
import { getHomeAllSports } from "@/lib/queries/allSports";
import { LeagueLogo } from "@/components/allSports/LeagueLogo";
import { AllSportEventRow, AllSportListHeader } from "@/components/allSports/AllSportEventRow";
import { EventListHeader, EventRow } from "@/components/book/EventRow";
import { TopPropsStrip } from "@/components/book/TopPropsStrip";
import { UfcCardSections, formatFightDate } from "@/components/book/UfcFightCard";
import { NewHerePrimer } from "@/components/dashboard/NewHerePrimer";
import { ValueBoard } from "@/components/book/ValueBoard";
import { Glyph, type GlyphKey } from "@/components/brand/Glyph";
import { ArchrMark } from "@/components/brand/ArchrMark";

// The lobby follows the day's games and lines — render per request.
export const dynamic = "force-dynamic";

/** How many games a sport shows in the lobby before "See all". */
const LOBBY_GAMES = 4;

function SectionHeader({ icon, title, subtitle, href, cta }: { icon: GlyphKey; title: string; subtitle?: string; href: string; cta: string }) {
  return (
    <div className="mb-2.5 flex items-end justify-between">
      <div className="flex items-center gap-2.5">
        <Glyph name={icon} className="size-6 text-foreground" />
        <div>
          <h2 className="font-display text-xl font-extrabold uppercase italic leading-none tracking-tight text-foreground">
            {title}
          </h2>
          {subtitle && <p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p>}
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
  // Incident 2026-11-08: a failing league read degrades this section alone
  // (logged, rendered as nothing) instead of tripping the root error
  // boundary and blanking the whole lobby.
  const [day] = await getLeagueDays(sport, today).catch((err) => {
    console.error(`[home] league days failed for ${sport}`, err);
    return [] as string[];
  });
  if (!day) return null;
  const events = await getLeagueEvents(sport, day).catch((err) => {
    console.error(`[home] league events failed for ${sport}`, err);
    return [];
  });
  if (events.length === 0) return null;
  const meta = sportMetaByKey[sport];
  return (
    <section>
      <SectionHeader
        icon={sport}
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

/** Every other sport: the next big games around the world, league by league. */
async function AllSportsSection() {
  const boards = await getHomeAllSports().catch(() => []);
  if (boards.length === 0) return null;
  return (
    <>
      {boards.map((b) => {
        const noSpread = !b.threeWay && b.events.every((e) => !e.spread.home && !e.spread.away && e.archr?.spread == null);
        return (
          <section key={b.league.id}>
            <div className="mb-2.5 flex items-end justify-between gap-2">
              <Link href={`/sports/${b.sport.key}/${b.league.slug}`} className="flex min-w-0 items-center gap-2.5">
                <LeagueLogo name={b.league.name} region={b.league.region} logoUrl={b.league.logoUrl} size={26} />
                <span className="min-w-0">
                  <span className="block truncate font-display text-xl font-extrabold uppercase italic leading-none tracking-tight text-foreground">{b.league.name}</span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {b.sport.label}
                    {b.league.region ? ` · ${b.league.region}` : ""}
                  </span>
                </span>
              </Link>
              <Link href={`/sports/${b.sport.key}/${b.league.slug}`} className="shrink-0 text-sm font-semibold text-primary hover:underline">
                See all ›
              </Link>
            </div>
            <AllSportListHeader threeWay={b.threeWay} noSpread={noSpread} />
            <div className="flex flex-col gap-2.5">
              {b.events.map((e) => (
                <AllSportEventRow key={e.id} event={e} sport={b.sport.key} threeWay={b.threeWay} noSpread={noSpread} />
              ))}
            </div>
          </section>
        );
      })}
      <Link href="/sports" className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-3 text-sm font-semibold text-foreground hover:border-foreground/30">
        <Glyph name="all" className="size-5" /> Every sport and league ›
      </Link>
    </>
  );
}

async function NbaPropsSection({ today }: { today: string }) {
  const [day] = await getLeagueDays("nba", today).catch(() => [] as string[]);
  const props = day
    ? await getTopNbaProps(day).catch((err) => {
        console.error("[home] top NBA props failed", err);
        return [];
      })
    : [];
  if (props.length === 0) return null;
  return (
    <section>
      <SectionHeader icon="props" title="Top NBA props" subtitle="Cleared the line in 8+ of the last 10" href={`/nba/props?date=${day}`} cta="All props" />
      <TopPropsStrip props={props} />
    </section>
  );
}

async function UfcSection() {
  const [event] = await listUpcomingUfcEvents(1).catch((err) => {
    console.error("[home] upcoming UFC events failed", err);
    return [] as Awaited<ReturnType<typeof listUpcomingUfcEvents>>;
  });
  if (!event || event.bouts.length === 0) return null;
  return (
    <section>
      <SectionHeader
        icon="ufc"
        title="UFC"
        subtitle={`${event.title} · ${formatFightDate(event.eventDate)}`}
        href={`/ufc?event=${event.id}`}
        cta="Full card"
      />
      <UfcCardSections event={event} upcoming limit={5} />
    </section>
  );
}

/**
 * The lobby's banner: always ink, whatever the theme — the brand's one dark,
 * loud surface — with the mark flying off the edge behind the headline.
 */
function LobbyHero({ dateLabel }: { dateLabel: string }) {
  return (
    <div className="relative mt-5 overflow-hidden rounded-2xl bg-[#07080b] bg-[radial-gradient(120%_90%_at_100%_100%,rgba(200,245,58,0.16),transparent_60%)] px-5 py-5 text-[#eef0f4] ring-1 ring-white/10">
      <ArchrMark className="pointer-events-none absolute -bottom-10 -right-6 h-48 w-auto text-white/[0.07]" />
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a90a0]">
        <span className="brand-slash" aria-hidden />
        {dateLabel}
      </p>
      <h1 className="mt-2 font-display text-[32px] font-extrabold uppercase italic leading-[0.95] tracking-tight">
        Best line.
        <br />
        <span className="text-[#c8f53a]">Every book.</span>
      </h1>
      <p className="mt-2.5 max-w-[17rem] text-[13px] leading-snug text-[#8a90a0]">
        Every price, every sportsbook, side by side. Tap a price to build your slip.
      </p>
    </div>
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
      <LobbyHero dateLabel={formatEtDateLabel(today)} />

      {/* Incident 2026-11-08: each section streams behind its own Suspense
          boundary. These sections aggregate the heaviest reads on the site;
          un-suspended, one stalled section held the entire lobby hostage —
          the page showed the global loading skeleton, then the root error
          screen. Now the shell and hero render at once and every section
          lands (or degrades) on its own. */}
      <div className="mt-6 flex flex-col gap-8">
        <Suspense fallback={null}>
          <ValueBoard today={today} />
        </Suspense>
        <Suspense fallback={null}>
          <LeagueSection sport="nba" today={today} />
        </Suspense>
        <Suspense fallback={null}>
          <NbaPropsSection today={today} />
        </Suspense>
        <Suspense fallback={null}>
          <LeagueSection sport="nfl" today={today} />
        </Suspense>
        <Suspense fallback={null}>
          <UfcSection />
        </Suspense>
        <Suspense fallback={null}>
          <AllSportsSection />
        </Suspense>
      </div>

      <div className="mt-8">
        <NewHerePrimer />
      </div>
    </div>
  );
}
