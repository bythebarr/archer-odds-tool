import type { Metadata } from "next";
import { getNflPostedLines, getNflPropsSlate } from "@/lib/queries/nflProps";
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
  // DraftKings' NFL numbers reach the feed days before their prices: the finder only needs the numbers.
  const posted = await getNflPostedLines(slate.games.map((g) => g.id));
  const hasLines = slate.props.some((p) => p.quotes.length > 0) || Object.keys(posted).length > 0;

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-24 pt-5 font-sans">
      <SportCarousel active="nfl" />
      <LeagueHeader sport="nfl" />
      <div className="mt-3">
        <SportTabs tabs={leagueTabs("nfl", "parlays")} />
      </div>
      {!hasLines ? (
        <div className="mt-8">
          <EmptyState title="No NFL props posted right now" freshness={freshness} arrow="miss" supportContext="nfl-parlays-empty">
            The finder builds parlays from the lines books hang; they post the week&apos;s props a few days before kickoff.
          </EmptyState>
        </div>
      ) : (
        <div className="mt-4">
          <NflParlayFinder slate={slate} posted={posted} />
        </div>
      )}
    </div>
  );
}
