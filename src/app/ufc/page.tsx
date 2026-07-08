import Link from "next/link";
import type { Metadata } from "next";
import {
  listRecentUfcEvents,
  listUpcomingUfcEvents,
  type UfcBoutSummary,
  type UfcEventSummary,
} from "@/lib/queries/ufcEvents";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FighterBadge } from "@/components/FighterBadge";
import { refreshUpcomingUfcOnView } from "@/lib/ufc/refreshUpcoming";

// UFC events are ingested by a daily backfill cron, so both the upcoming and
// recent lists change day to day — render per request rather than statically.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "UFC — fighter-math matchups",
  description:
    "Upcoming UFC cards and recent results with archer's transparent fighter-math win-probability projections.",
};

function formatEventDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  }).format(date);
}

function BoutRow({ bout, upcoming = false }: { bout: UfcBoutSummary; upcoming?: boolean }) {
  const redWon = bout.winnerFighterId === bout.red.id;
  const blueWon = bout.winnerFighterId === bout.blue.id;

  // Upcoming bouts have no result yet — show both fighters at full weight
  // rather than dimming both (which would read as "both lost").
  const redClass = upcoming ? "font-medium text-foreground" : redWon ? "font-semibold text-foreground" : "text-muted-foreground";
  const blueClass = upcoming ? "font-medium text-foreground" : blueWon ? "font-semibold text-foreground" : "text-muted-foreground";

  return (
    <Link
      href={`/ufc/${bout.id}`}
      className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/50"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <FighterBadge name={bout.red.name} imageUrl={bout.red.imageUrl} size={22} />
            <span className={redClass}>{bout.red.name}</span>
          </span>
          <span className="text-xs text-muted-foreground">vs</span>
          <span className="inline-flex items-center gap-1.5">
            <FighterBadge name={bout.blue.name} imageUrl={bout.blue.imageUrl} size={22} />
            <span className={blueClass}>{bout.blue.name}</span>
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {bout.weightClass}
          {!upcoming && bout.method ? ` · ${bout.method}${bout.resultRound ? ` R${bout.resultRound}` : ""}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {bout.titleBout ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            Title
          </span>
        ) : null}
        {upcoming ? (
          <span aria-hidden className="text-sm text-muted-foreground">
            ›
          </span>
        ) : null}
      </div>
    </Link>
  );
}

function EventCard({ event, upcoming = false }: { event: UfcEventSummary; upcoming?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <h3 className="text-sm font-semibold text-foreground">{event.title}</h3>
        <p className="text-xs text-muted-foreground">
          {formatEventDate(event.eventDate)}
          {event.location ? ` · ${event.location}` : ""}
        </p>
      </CardHeader>
      <CardContent className="divide-y divide-border/60">
        {event.bouts.map((bout) => (
          <BoutRow key={bout.id} bout={bout} upcoming={upcoming} />
        ))}
      </CardContent>
    </Card>
  );
}

export default async function UfcPage() {
  // Read-side self-heal for the upcoming feed (Hobby crons fire unreliably) —
  // backfills after the response when stale. See refreshUpcomingUfcOnView.
  refreshUpcomingUfcOnView();
  const [upcoming, recent] = await Promise.all([listUpcomingUfcEvents(), listRecentUfcEvents()]);

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <h1 className="text-xl font-semibold text-foreground">UFC</h1>
      <p className="text-sm text-muted-foreground">
        Upcoming cards and recent results with archer&apos;s transparent fighter-math projections — research/discovery
        only, no bet placement or tracking.
      </p>

      {upcoming.length > 0 ? (
        <section className="mt-8">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Upcoming</h2>
            <span className="text-xs text-muted-foreground">pre-fight projections</span>
          </div>
          <div className="mt-3 flex flex-col gap-4">
            {upcoming.map((event) => (
              <EventCard key={event.id} event={event} upcoming />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent results</h2>
        {recent.length === 0 ? (
          <p className="mt-4 text-center text-sm text-muted-foreground">No UFC events ingested yet.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {recent.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </section>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Recent list shows fully-ingested events only. Fighter data via the Cito API.
      </p>
    </div>
  );
}
