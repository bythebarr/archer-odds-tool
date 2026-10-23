import Link from "next/link";
import type { Metadata } from "next";
import { listRecentUfcEvents, listUpcomingUfcEvents } from "@/lib/queries/ufcEvents";
import { refreshUpcomingUfcOnView } from "@/lib/ufc/refreshUpcoming";
import { refreshUfcOddsOnView } from "@/lib/ufc/refreshOddsOnView";
import { SportCarousel } from "@/components/book/SportCarousel";
import { LeagueHeader } from "@/components/book/LeaguePage";
import { SportTabs } from "@/components/book/SportTabs";
import { UfcCardSections, UfcEventHero, formatFightDate } from "@/components/book/UfcFightCard";
import { EmptyState } from "@/components/EmptyState";

// UFC events are ingested by a daily backfill cron, so both the upcoming and
// recent lists change day to day — render per request rather than statically.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "UFC — fight cards, best moneylines and fighter math",
  description: "Every upcoming UFC card with the best moneyline across books, fighter photos and records, and ARCHR's fighter-math projections.",
};

/**
 * UFC in the sportsbook layout: the sport switcher, Fight Cards / Results tabs,
 * a strip of upcoming cards, then the chosen card's banner and its bouts grouped
 * Main Card / Prelims — each corner with its best moneyline, tappable into the slip.
 */
export default async function UfcPage({ searchParams }: { searchParams: Promise<{ tab?: string; event?: string }> }) {
  // Read-side self-heal for the upcoming feed and the moneylines (Hobby crons
  // fire unreliably) — each refreshes after the response when stale.
  refreshUpcomingUfcOnView();
  refreshUfcOddsOnView();
  const { tab, event: eventParam } = await searchParams;
  const results = tab === "results";

  const tabs = [
    { label: "Fight Cards", href: "/ufc", active: !results },
    { label: "Results", href: "/ufc?tab=results", active: results },
  ];

  if (results) {
    const recent = await listRecentUfcEvents(6);
    return (
      <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-10 pt-5 font-sans">
        <SportCarousel active="ufc" />
        <LeagueHeader sport="ufc" />
        <div className="mt-3">
          <SportTabs tabs={tabs} />
        </div>
        {recent.length === 0 ? (
          <div className="mt-6">
            <EmptyState title="No results yet" arrow="miss" supportContext="ufc-results-empty">
              Results land the day after each card.
            </EmptyState>
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-8">
            {recent.map((e) => (
              <section key={e.id}>
                <h2 className="font-display text-lg font-extrabold uppercase italic leading-tight tracking-tight text-foreground">{e.title}</h2>
                <p className="mb-3 text-[11px] text-muted-foreground">
                  {formatFightDate(e.eventDate, true)}
                  {e.location ? ` · ${e.location}` : ""}
                </p>
                <UfcCardSections event={e} upcoming={false} />
              </section>
            ))}
          </div>
        )}
      </div>
    );
  }

  const upcoming = await listUpcomingUfcEvents();
  const event = upcoming.find((e) => e.id === eventParam) ?? upcoming[0];

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-10 pt-5 font-sans">
      <SportCarousel active="ufc" />
      <LeagueHeader sport="ufc" />
      <div className="mt-3">
        <SportTabs tabs={tabs} />
      </div>

      {upcoming.length > 1 && (
        <div className="-mx-4 mt-4 overflow-x-auto px-4 [scrollbar-width:none]">
          <div className="flex gap-2">
            {upcoming.map((e) => {
              const active = e.id === event?.id;
              return (
                <Link
                  key={e.id}
                  href={`/ufc?event=${e.id}`}
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className={`flex max-w-[11rem] shrink-0 flex-col rounded-xl px-3 py-1.5 transition-colors ${
                    active ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="truncate text-xs font-semibold">{e.title}</span>
                  <span className="text-[10px] opacity-75">{formatFightDate(e.eventDate)}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {!event ? (
        <div className="mt-6">
          <EmptyState title="No cards on the schedule" arrow="miss" supportContext="ufc-empty">
            The next UFC card appears here as soon as it&apos;s announced.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="mt-4">
            <UfcEventHero event={event} />
          </div>
          <div className="mt-6">
            <UfcCardSections event={event} upcoming />
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            Best moneyline across bettable books; the dot on each price is the book. Tap a price to add it to your slip,
            or Matchup for the tale of the tape and ARCHR&apos;s fighter math.
          </p>
        </>
      )}
    </div>
  );
}
