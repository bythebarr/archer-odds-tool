import type { Metadata } from "next";
import Link from "next/link";
import { getF1Season, type F1DriverStanding, type F1ConstructorStanding, type F1ResultRow } from "@/lib/queries/f1";
import { refreshF1OnView } from "@/lib/f1/refreshOnView";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FlagBadge } from "@/components/FlagBadge";
import { PageShell, PageHeader } from "@/components/PageShell";
import { RaceCountdown } from "@/components/f1/RaceCountdown";
import { EmptyState } from "@/components/EmptyState";

// F1 data is ingested by a backfill cron and self-healed on view; the next
// race and standings shift race to race, so render per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "F1 — championship & the next race",
  description:
    "Formula 1 driver and constructor championship standings, the latest podium, and a countdown to the next Grand Prix. Free, results-driven, no odds.",
};

function raceDateLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(date);
}

function shortDateLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  }).format(date);
}

function pts(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function DriverRow({ d }: { d: F1DriverStanding }) {
  const leader = d.rank === 1;
  return (
    <Link
      href={`/f1/driver/${d.ergastDriverId}`}
      className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/50"
    >
      <span
        className={`w-5 shrink-0 text-right font-mono text-sm tabular-nums ${
          leader ? "font-bold text-primary" : "text-muted-foreground"
        }`}
      >
        {d.rank}
      </span>
      <FlagBadge flag={d.flag} title={d.name} size={22} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">{d.name}</span>
          {d.code ? (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{d.code}</span>
          ) : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">{d.constructorName}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-sm font-semibold tabular-nums text-foreground">{pts(d.points)}</div>
        <div className="text-[10px] text-muted-foreground">
          {d.wins > 0 ? `${d.wins} W · ` : ""}
          {d.podiums} P
        </div>
      </div>
    </Link>
  );
}

function ConstructorRow({ c }: { c: F1ConstructorStanding }) {
  const leader = c.rank === 1;
  return (
    <Link
      href={`/f1/constructor/${c.ergastConstructorId}`}
      className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/50"
    >
      <span
        className={`w-5 shrink-0 text-right font-mono text-sm tabular-nums ${
          leader ? "font-bold text-primary" : "text-muted-foreground"
        }`}
      >
        {c.rank}
      </span>
      <FlagBadge flag={c.flag} title={c.name} size={22} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{c.name}</span>
      <div className="shrink-0 text-right">
        <div className="font-mono text-sm font-semibold tabular-nums text-foreground">{pts(c.points)}</div>
        {c.wins > 0 ? <div className="text-[10px] text-muted-foreground">{c.wins} W</div> : null}
      </div>
    </Link>
  );
}

const PODIUM_ACCENT: Record<number, string> = {
  1: "text-amber-500",
  2: "text-zinc-400",
  3: "text-orange-600 dark:text-orange-400",
};

function ResultRow({ r }: { r: F1ResultRow }) {
  const podium = r.position != null && r.position <= 3;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span
        className={`w-6 shrink-0 text-right font-mono text-sm font-semibold tabular-nums ${
          podium ? PODIUM_ACCENT[r.position as number] : "text-muted-foreground"
        }`}
      >
        {r.positionText}
      </span>
      <FlagBadge flag={r.flag} title={r.driverName} size={20} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm text-foreground">{r.driverName}</span>
          {r.fastestLap ? (
            <span
              title="Fastest lap"
              className="shrink-0 rounded bg-purple-100 px-1 text-[9px] font-bold uppercase tracking-wide text-purple-700 dark:bg-purple-950 dark:text-purple-300"
            >
              FL
            </span>
          ) : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">{r.constructorName}</div>
      </div>
      <div className="shrink-0 text-right">
        {r.points > 0 ? (
          <div className="font-mono text-sm tabular-nums text-foreground">+{pts(r.points)}</div>
        ) : (
          <div className="text-xs text-muted-foreground">{r.status}</div>
        )}
      </div>
    </div>
  );
}

export default async function F1Page() {
  // Read-side self-heal (calendar + newly-run results) — fires after response.
  refreshF1OnView();
  const season = await getF1Season();

  if (!season || season.driverStandings.length === 0) {
    return (
      <PageShell width="2xl">
        <PageHeader title="F1" description="Formula 1 championship, the latest podium, and the next Grand Prix." />
        <EmptyState title="No F1 season data yet" arrow="miss" supportContext="f1-empty">
          Standings and results build from the season&apos;s completed races. If it&apos;s mid-season and this is
          still empty, the results feed may be catching up.
        </EmptyState>
      </PageShell>
    );
  }

  const { nextRace, latestRace, driverStandings, constructorStandings, roundsCompleted } = season;

  return (
    <PageShell width="2xl">
      <PageHeader
        title="F1"
        description={`${season.season} season · ${roundsCompleted} rounds run · free, results-driven (no odds).`}
      />

      {/* Next race hero — or a between-seasons note when the calendar is dry. */}
      {nextRace ? (
        <Card className="mt-6 overflow-hidden border-[#e10600]/30">
          <div className="h-1 w-full bg-[#e10600]" />
          <CardContent className="pt-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#e10600]">
                  Next race · Round {nextRace.round}
                </div>
                <h2 className="mt-0.5 text-lg font-bold text-foreground">{nextRace.raceName}</h2>
                <p className="text-sm text-muted-foreground">
                  {nextRace.circuitName}
                  {nextRace.locality ? ` · ${nextRace.locality}` : ""}
                  {nextRace.country ? `, ${nextRace.country}` : ""}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{raceDateLabel(nextRace.raceDate)}</p>
              </div>
              <RaceCountdown targetIso={nextRace.raceDate.toISOString()} />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-6">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            No upcoming race on the calendar right now — between rounds or between seasons.
          </CardContent>
        </Card>
      )}

      {/* Championship standings */}
      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-1">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Drivers</h3>
          </CardHeader>
          <CardContent className="divide-y divide-border/60">
            {driverStandings.map((d) => (
              <DriverRow key={d.ergastDriverId} d={d} />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Constructors</h3>
          </CardHeader>
          <CardContent className="divide-y divide-border/60">
            {constructorStandings.map((c) => (
              <ConstructorRow key={c.name} c={c} />
            ))}
          </CardContent>
        </Card>
      </section>

      {/* Latest race */}
      {latestRace ? (
        <section className="mt-8">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Latest · {latestRace.raceName}
                </h3>
                <span className="text-xs text-muted-foreground">
                  R{latestRace.round} · {shortDateLabel(latestRace.raceDate)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {latestRace.circuitName}
                {latestRace.country ? ` · ${latestRace.country}` : ""}
              </p>
            </CardHeader>
            <CardContent className="divide-y divide-border/60">
              {latestRace.results.map((r) => (
                <ResultRow key={`${r.positionText}-${r.driverName}`} r={r} />
              ))}
            </CardContent>
          </Card>
        </section>
      ) : null}

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Results via the free Jolpica/Ergast F1 API · no betting markets, research only.
      </p>
    </PageShell>
  );
}
