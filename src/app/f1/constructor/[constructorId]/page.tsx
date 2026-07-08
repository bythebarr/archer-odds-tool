import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getConstructorSeason, type F1ConstructorRaceRow } from "@/lib/queries/f1";
import { PageShell } from "@/components/PageShell";
import { BackLink } from "@/components/BackLink";
import { FlagBadge } from "@/components/FlagBadge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ constructorId: string }>;
}): Promise<Metadata> {
  const { constructorId } = await params;
  const c = await getConstructorSeason(constructorId);
  if (!c) return {};
  const title = `${c.name} — ${c.season} F1 season`;
  const description = `${c.name}: P${c.rank} in the ${c.season} constructors' championship on ${pts(c.points)} points, ${c.wins} wins, ${c.podiums} podiums.`;
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

/** One car's result within a weekend — "LEC P1" with podium tint / DNF. */
function EntryChip({
  code,
  positionText,
  fastestLap,
}: {
  code: string | null;
  positionText: string;
  fastestLap: boolean;
}) {
  const dnf = !/^\d+$/.test(positionText);
  const pos = dnf ? null : Number(positionText);
  const tint = pos != null && pos <= 3 ? PODIUM_ACCENT[pos] : dnf ? "text-muted-foreground" : "text-foreground";
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="font-mono text-[10px] text-muted-foreground">{code ?? "—"}</span>
      <span className={`font-mono text-xs font-semibold tabular-nums ${tint}`}>{dnf ? "DNF" : `P${positionText}`}</span>
      {fastestLap ? (
        <span
          title="Fastest lap"
          className="rounded bg-purple-100 px-1 text-[8px] font-bold uppercase text-purple-700 dark:bg-purple-950 dark:text-purple-300"
        >
          FL
        </span>
      ) : null}
    </span>
  );
}

function RaceRow({ r }: { r: F1ConstructorRaceRow }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="w-6 shrink-0 text-center font-mono text-xs text-muted-foreground">R{r.round}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-foreground">{r.raceName.replace(/ Grand Prix$/, " GP")}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {r.entries.map((e, i) => (
            <EntryChip key={i} code={e.code} positionText={e.positionText} fastestLap={e.fastestLap} />
          ))}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-sm font-semibold tabular-nums text-foreground">
          {r.points > 0 ? `+${pts(r.points)}` : "0"}
        </div>
        <div className="text-[10px] text-muted-foreground">{shortDate(r.raceDate)}</div>
      </div>
    </div>
  );
}

export default async function F1ConstructorPage({
  params,
}: {
  params: Promise<{ constructorId: string }>;
}) {
  const { constructorId } = await params;
  const c = await getConstructorSeason(constructorId);
  if (!c) notFound();

  return (
    <PageShell width="2xl">
      <BackLink fallbackHref="/f1" className="text-sm text-muted-foreground hover:text-foreground">
        ← F1 championship
      </BackLink>

      <div className="mt-4 flex items-center gap-3">
        <FlagBadge flag={c.flag} title={c.nationality ?? c.name} size={40} />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-foreground">{c.name}</h1>
          <p className="text-sm text-muted-foreground">{c.season} constructors&apos; championship</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <StatTile label="Championship" value={`P${c.rank}`} accent={c.rank === 1 ? "text-primary" : undefined} />
        <StatTile label="Points" value={pts(c.points)} />
        <StatTile label="Wins" value={String(c.wins)} />
        <StatTile label="Podiums" value={String(c.podiums)} />
        <StatTile label="Best" value={c.bestFinish != null ? `P${c.bestFinish}` : "—"} />
        <StatTile label="Drivers" value={String(c.drivers.length)} />
      </div>

      {/* Drivers — tappable through to each driver's season card. */}
      <Card className="mt-8">
        <CardHeader className="pb-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Drivers</h2>
        </CardHeader>
        <CardContent className="divide-y divide-border/60">
          {c.drivers.map((d) => (
            <Link
              key={d.ergastDriverId}
              href={`/f1/driver/${d.ergastDriverId}`}
              className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/50"
            >
              <FlagBadge flag={d.flag} title={d.name} size={22} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {d.name}
                {d.code ? <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{d.code}</span> : null}
              </span>
              <div className="shrink-0 text-right">
                <div className="font-mono text-sm font-semibold tabular-nums text-foreground">{pts(d.points)}</div>
                {d.wins > 0 ? <div className="text-[10px] text-muted-foreground">{d.wins} W</div> : null}
              </div>
              <span aria-hidden className="text-sm text-muted-foreground">
                ›
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>

      {/* Race by race — both cars each weekend. */}
      <Card className="mt-6">
        <CardHeader className="pb-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Race by race</h2>
        </CardHeader>
        <CardContent className="divide-y divide-border/60">
          {c.races.map((r) => (
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
