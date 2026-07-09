import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDriverSeason, type F1DriverRaceRow } from "@/lib/queries/f1";
import { PageShell } from "@/components/PageShell";
import { BackLink } from "@/components/BackLink";
import { FlagBadge } from "@/components/FlagBadge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ driverId: string }>;
}): Promise<Metadata> {
  const { driverId } = await params;
  const d = await getDriverSeason(driverId);
  if (!d) return {};
  const title = `${d.name} — ${d.season} F1 season`;
  const description = `${d.name}: P${d.rank} in the ${d.season} championship on ${pts(d.points)} points, ${d.wins} wins, ${d.podiums} podiums for ${d.constructorName}.`;
  return { title, description, openGraph: { title, description }, twitter: { title, description } };
}

function pts(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function shortDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(date);
}

const PODIUM_ACCENT: Record<number, string> = {
  1: "text-amber-500",
  2: "text-zinc-400",
  3: "text-orange-600 dark:text-orange-400",
};

function StatTile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-border bg-card px-2 py-3 text-center">
      <span className={`font-mono text-xl font-bold tabular-nums ${accent ?? "text-foreground"}`}>{value}</span>
      <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

function RaceRow({ r }: { r: F1DriverRaceRow }) {
  // A non-numeric positionText ("R"/"D"/…) is a true retirement; a numeric one
  // is a classified finish even if the status says "Retired".
  const dnf = !/^\d+$/.test(r.positionText);
  const podium = !dnf && r.position != null && r.position <= 3;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="w-6 shrink-0 text-center font-mono text-xs text-muted-foreground">R{r.round}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-foreground">{r.raceName.replace(/ Grand Prix$/, " GP")}</div>
        <div className="text-xs text-muted-foreground">
          {shortDate(r.raceDate)}
          {r.grid != null ? ` · from P${r.grid}` : ""}
          {r.fastestLap ? " · fastest lap" : ""}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div
          className={`font-mono text-sm font-semibold tabular-nums ${
            podium ? PODIUM_ACCENT[r.position as number] : dnf ? "text-muted-foreground" : "text-foreground"
          }`}
        >
          {dnf ? "DNF" : `P${r.positionText}`}
        </div>
        <div className="text-[10px] text-muted-foreground">{r.points > 0 ? `+${pts(r.points)} pts` : r.status}</div>
      </div>
    </div>
  );
}

export default async function F1DriverPage({ params }: { params: Promise<{ driverId: string }> }) {
  const { driverId } = await params;
  const d = await getDriverSeason(driverId);
  if (!d) notFound();

  return (
    <PageShell width="2xl">
      <BackLink fallbackHref="/f1" className="text-sm text-muted-foreground hover:text-foreground">
        ← F1 championship
      </BackLink>

      <div className="mt-4 flex items-center gap-3">
        <FlagBadge flag={d.flag} title={d.nationality ?? d.name} size={40} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold text-foreground">{d.name}</h1>
            {d.code ? <span className="font-mono text-xs text-muted-foreground">{d.code}</span> : null}
            {d.permanentNumber != null ? (
              <span className="font-mono text-xs text-muted-foreground">#{d.permanentNumber}</span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {d.constructorName} · {d.season} season
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <StatTile label="Championship" value={`P${d.rank}`} accent={d.rank === 1 ? "text-primary" : undefined} />
        <StatTile label="Points" value={pts(d.points)} />
        <StatTile label="Wins" value={String(d.wins)} />
        <StatTile label="Podiums" value={String(d.podiums)} />
        <StatTile label="Best" value={d.bestFinish != null ? `P${d.bestFinish}` : "—"} />
        <StatTile label="Starts" value={String(d.starts)} />
      </div>

      <Card className="mt-8">
        <CardHeader className="pb-1">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Race by race</h2>
            {d.dnfs > 0 ? <span className="text-xs text-muted-foreground">{d.dnfs} DNF{d.dnfs === 1 ? "" : "s"}</span> : null}
          </div>
        </CardHeader>
        <CardContent className="divide-y divide-border/60">
          {d.races.map((r) => (
            <RaceRow key={r.round} r={r} />
          ))}
        </CardContent>
      </Card>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Results via the free Jolpica/Ergast F1 API · research only.
      </p>
    </PageShell>
  );
}
