import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSoccerPropsSlate } from "@/lib/queries/soccerProps";
import { SportCarousel } from "@/components/book/SportCarousel";
import { SportTabs } from "@/components/book/SportTabs";
import { Glyph } from "@/components/brand/Glyph";
import { EmptyState } from "@/components/EmptyState";
import { SoccerPropsFinder } from "@/components/soccer/SoccerPropsFinder";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Soccer player props — anytime goalscorer, shots, saves, cards",
  description: "Every league's player props: anytime goalscorer and assist, shots, shots on target, saves, cards and fouls, with ARCHR's chance and fair price and every match charted.",
};

/** Soccer player props, a league at a time (sports/[sport]/props — soccer only for now). */
export default async function SportPropsPage({ params, searchParams }: { params: Promise<{ sport: string }>; searchParams: Promise<{ league?: string; match?: string }> }) {
  const { sport } = await params;
  if (sport !== "soccer") notFound();
  const { league, match } = await searchParams;
  const slate = await getSoccerPropsSlate(league ?? null);

  return (
    <div className="mx-auto min-h-screen w-full min-w-0 max-w-2xl px-4 pb-10 pt-5 font-sans">
      <SportCarousel active="soccer" />
      <div className="mt-5 flex items-center gap-2.5 text-foreground">
        <Glyph name="soccer" className="size-8" />
        <h1 className="font-display text-3xl font-extrabold uppercase italic leading-none tracking-tight">Soccer</h1>
      </div>
      <div className="mt-3">
        <SportTabs
          tabs={[
            { label: "Game Lines", href: "/sports/soccer", active: false },
            { label: "Player Props", href: "/sports/soccer/props", active: true },
          ]}
        />
      </div>
      {slate.league && (
        <p className="mt-3 text-sm text-muted-foreground">
          {slate.league.name} · {Object.keys(slate.players).length} players across {slate.matches.length} {slate.matches.length === 1 ? "match" : "matches"}
        </p>
      )}
      {slate.matches.length === 0 || Object.keys(slate.players).length === 0 ? (
        <div className="mt-8">
          <EmptyState title="No player props here yet">
            Props show for every league ESPN carries once its teams have a few matches on record; the history fills in a few times a day.
          </EmptyState>
          {slate.leagues.length > 0 && <SoccerPropsFinder slate={slate} />}
        </div>
      ) : (
        <SoccerPropsFinder key={slate.league?.id} slate={slate} initialMatch={match ?? null} />
      )}
    </div>
  );
}
