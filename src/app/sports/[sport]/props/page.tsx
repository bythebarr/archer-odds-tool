import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSoccerPropsSlate } from "@/lib/queries/soccerProps";
import { getTennisPropsSlate } from "@/lib/queries/tennisProps";
import { TennisPropsFinder } from "@/components/tennis/TennisPropsFinder";
import { SportCarousel } from "@/components/book/SportCarousel";
import { SportTabs } from "@/components/book/SportTabs";
import { Glyph } from "@/components/brand/Glyph";
import { EmptyState } from "@/components/EmptyState";
import { SoccerPropsFinder } from "@/components/soccer/SoccerPropsFinder";
import { refreshOnView } from "@/lib/ops/refreshOnView";
import { PropsScreener, type ScreenerParams } from "@/components/screener/PropsScreener";
import { PropsViewToggle, wantsScreen } from "@/components/screener/PropsViewToggle";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Soccer player props — anytime goalscorer, shots, saves, cards",
  description: "Every league's player props: anytime goalscorer and assist, shots, shots on target, saves, cards and fouls, with ARCHR's chance and fair price and every match charted.",
};

/** Soccer player props, a league at a time (sports/[sport]/props — soccer only for now). */
export default async function SportPropsPage({ params, searchParams }: { params: Promise<{ sport: string }>; searchParams: Promise<{ league?: string; match?: string } & ScreenerParams> }) {
  const { sport } = await params;
  await refreshOnView(sport === "tennis" ? [["tennis-fixtures", 30]] : sport === "soccer" ? [["soccer-player-stats", 60], ["espn-odds", 30]] : []);
  const query = await searchParams;
  const { league, match } = query;
  const screen = wantsScreen(query);
  if (sport === "tennis") return <TennisPropsPage match={match ?? null} params={query} />;
  if (sport !== "soccer") notFound();
  const slate = await getSoccerPropsSlate(league ?? null);

  return (
    <div className={`mx-auto min-h-screen w-full min-w-0 px-4 pb-10 pt-5 font-sans ${screen ? "max-w-6xl" : "max-w-2xl"}`}>
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
      <PropsViewToggle basePath="/sports/soccer/props" screen={screen} />
      {screen && (
        <div className="mt-4">
          <PropsScreener params={query} basePath="/sports/soccer/props" sport="soccer" keep={{ view: "screen" }} />
        </div>
      )}
      {!screen && slate.league && (
        <p className="mt-3 text-sm text-muted-foreground">
          {slate.league.name} · {Object.keys(slate.players).length} players across {slate.matches.length} {slate.matches.length === 1 ? "match" : "matches"}
        </p>
      )}
      {screen ? null : slate.matches.length === 0 || Object.keys(slate.players).length === 0 ? (
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

async function TennisPropsPage({ match, params }: { match: string | null; params: ScreenerParams }) {
  const screen = wantsScreen(params);
  const slate = await getTennisPropsSlate();
  return (
    <div className={`mx-auto min-h-screen w-full min-w-0 px-4 pb-10 pt-5 font-sans ${screen ? "max-w-6xl" : "max-w-2xl"}`}>
      <SportCarousel active="tennis" />
      <div className="mt-5 flex items-center gap-2.5 text-foreground">
        <Glyph name="tennis" className="size-8" />
        <h1 className="font-display text-3xl font-extrabold uppercase italic leading-none tracking-tight">Tennis</h1>
      </div>
      <div className="mt-3">
        <SportTabs
          tabs={[
            { label: "Match Lines", href: "/sports/tennis", active: false },
            { label: "Player Props", href: "/sports/tennis/props", active: true },
          ]}
        />
      </div>
      <PropsViewToggle basePath="/sports/tennis/props" screen={screen} />
      {screen && (
        <div className="mt-4">
          <PropsScreener params={params} basePath="/sports/tennis/props" sport="tennis" keep={{ view: "screen" }} />
        </div>
      )}
      {screen ? null : slate.matches.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="No singles matches in the next day and a half">Props show for every ATP and WTA match as soon as the draw is set.</EmptyState>
        </div>
      ) : (
        <TennisPropsFinder slate={slate} initialMatch={match} />
      )}
    </div>
  );
}
