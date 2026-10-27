import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getEventPage } from "@/lib/queries/allSports";
import { EventBreakdown, EventFaceOff } from "@/components/allSports/EventBreakdown";
import { GameMarketBoard } from "@/components/game/GameMarketBoard";
import { SectionTitle } from "@/components/matchup/Matchup";

export const dynamic = "force-dynamic";

const load = cache((id: string) => getEventPage(decodeURIComponent(id)));
type Params = Promise<{ sport: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const view = await load(id);
  if (!view) return {};
  const title = `${view.home} vs ${view.away}`;
  return { title, description: `${title} — ${view.league.name} odds at every book and ARCHR's read on every market.` };
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase())
    .join("");

function when(d: Date, status: string): string {
  if (status === "live") return "Live now";
  if (status === "final") return "Final";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(d);
}

/** Any game in any sport: the face-off and breakdown, then every market at every book. */
export default async function AllSportEventPage({ params }: { params: Params }) {
  const { sport, id } = await params;
  const view = await load(id);
  if (!view || view.sport.key !== sport) notFound();
  const teams = {
    home: { name: view.home, abbreviation: initials(view.home), logoUrl: view.homeLogo },
    away: { name: view.away, abbreviation: initials(view.away), logoUrl: view.awayLogo },
  };

  return (
    <div className="mx-auto min-h-screen w-full min-w-0 max-w-2xl px-4 pb-10 pt-5 font-sans">
      <Link href={`/sports/${sport}/${view.league.slug}`} className="text-sm text-muted-foreground hover:text-foreground">
        ← {view.league.name}
      </Link>
      <EventFaceOff view={view} when={when(view.startsAt, view.status)} />
      <EventBreakdown view={view} />
      <section className="mt-6">
        <SectionTitle aside={view.lastOddsAt ? <span className="text-[10px] text-muted-foreground">Prices {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(view.lastOddsAt)} ET</span> : null}>
          Every market
        </SectionTitle>
        {view.offers.length > 0 ? (
          <GameMarketBoard offers={view.offers} teams={teams} sport="all" matchId={view.id} />
        ) : (
          <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">No prices posted yet — books usually hang this a day or two out.</p>
        )}
      </section>
    </div>
  );
}
