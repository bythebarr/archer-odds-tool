import type { Metadata } from "next";
import { getNflPropsSlate } from "@/lib/queries/nflProps";
import { SportCarousel } from "@/components/book/SportCarousel";
import { SportTabs } from "@/components/book/SportTabs";
import { LeagueHeader, leagueTabs } from "@/components/book/LeaguePage";
import { EmptyState } from "@/components/EmptyState";
import { getFeedFreshness } from "@/lib/freshness";
import { NflParlayFinder } from "@/components/nfl/NflParlayFinder";
import { refreshOnView } from "@/lib/ops/refreshOnView";

export const metadata: Metadata = {
  title: "NFL Parlay Finder — same-game legs that have hit together",
  description: "Same-game NFL parlays, 2 to 15 legs with alt lines, ranked by how often every leg has cashed together in the games the players shared.",
};

export const dynamic = "force-dynamic";

export default async function NflParlaysPage() {
  await refreshOnView([["sync-results-nfl", 60], ["espn-props", 30]]);
  const [slate, freshness] = await Promise.all([getNflPropsSlate(), getFeedFreshness("nflProps")]);
  const posted = slate.props.some((p) => p.quotes.some((q) => q.priceAmerican !== null));

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-24 pt-5 font-sans">
      <SportCarousel active="nfl" />
      <LeagueHeader sport="nfl" />
      <div className="mt-3">
        <SportTabs tabs={leagueTabs("nfl", "parlays")} />
      </div>
      {!posted ? (
        <div className="mt-8">
          <EmptyState title="No NFL props priced right now" freshness={freshness} arrow="miss" supportContext="nfl-parlays-empty">
            The finder builds parlays from the lines books hang; they price the week&apos;s props a few days before kickoff.
          </EmptyState>
        </div>
      ) : (
        <div className="mt-4">
          <NflParlayFinder slate={slate} />
        </div>
      )}
    </div>
  );
}
