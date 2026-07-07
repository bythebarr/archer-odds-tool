import Link from "next/link";
import type { Metadata } from "next";
import { listRecentUfcEvents, type UfcBoutSummary } from "@/lib/queries/ufcEvents";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

// UFC events are ingested by a daily backfill cron, so the "recent events"
// list changes day to day — render per request rather than statically.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "UFC — fighter-math matchups",
  description: "UFC events, results, and archer's transparent fighter-math win-probability projections.",
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

function BoutRow({ bout }: { bout: UfcBoutSummary }) {
  const redWon = bout.winnerFighterId === bout.red.id;
  const blueWon = bout.winnerFighterId === bout.blue.id;

  return (
    <Link
      href={`/ufc/${bout.id}`}
      className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/50"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
          <span className={redWon ? "font-semibold text-foreground" : "text-muted-foreground"}>{bout.red.name}</span>
          <span className="text-xs text-muted-foreground">vs</span>
          <span className={blueWon ? "font-semibold text-foreground" : "text-muted-foreground"}>{bout.blue.name}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {bout.weightClass}
          {bout.method ? ` · ${bout.method}${bout.resultRound ? ` R${bout.resultRound}` : ""}` : ""}
        </p>
      </div>
      {bout.titleBout ? (
        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          Title
        </span>
      ) : null}
    </Link>
  );
}

export default async function UfcPage() {
  const events = await listRecentUfcEvents();

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <h1 className="text-xl font-semibold text-foreground">UFC</h1>
      <p className="text-sm text-muted-foreground">
        Recent events with archer&apos;s transparent fighter-math projections — research/discovery only, no bet placement
        or tracking.
      </p>

      {events.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">No UFC events ingested yet.</p>
      ) : (
        <div className="mt-8 flex flex-col gap-4">
          {events.map((event) => (
            <Card key={event.id}>
              <CardHeader className="pb-2">
                <h2 className="text-sm font-semibold text-foreground">{event.title}</h2>
                <p className="text-xs text-muted-foreground">
                  {formatEventDate(event.eventDate)}
                  {event.location ? ` · ${event.location}` : ""}
                </p>
              </CardHeader>
              <CardContent className="divide-y divide-border/60">
                {event.bouts.map((bout) => (
                  <BoutRow key={bout.id} bout={bout} />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Showing fully-ingested events only. Fighter data via the Cito API.
      </p>
    </div>
  );
}
