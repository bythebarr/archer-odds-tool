import type { Metadata } from "next";
import { getNflPropsSlate } from "@/lib/queries/nflProps";
import { getFeedFreshness } from "@/lib/freshness";
import { SportCarousel } from "@/components/book/SportCarousel";
import { SportTabs } from "@/components/book/SportTabs";
import { LeagueHeader, leagueTabs } from "@/components/book/LeaguePage";
import { EmptyState } from "@/components/EmptyState";
import { FreshnessStamp } from "@/components/FreshnessStamp";
import { NflPropsFinder } from "@/components/nfl/NflPropsFinder";
import { refreshOnView } from "@/lib/ops/refreshOnView";

export const metadata: Metadata = {
  title: "NFL Props — best price, hit rate and projection at every line",
  description: "NFL player props for the week: the best Over and Under across sportsbooks, hit rates, matchups and ARCHR's projection.",
};

export const dynamic = "force-dynamic";

export default async function NflPropsPage() {
  await refreshOnView([["sync-results-nfl", 60], ["nfl-advanced", 180], ["espn-odds", 30]]);
  const [slate, freshness] = await Promise.all([getNflPropsSlate(), getFeedFreshness("nflProps")]);
  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-10 pt-5 font-sans">
      <SportCarousel active="nfl" />
      <LeagueHeader sport="nfl" />
      <div className="mt-3">
        <SportTabs tabs={leagueTabs("nfl", "props")} />
      </div>
      {slate.props.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="No NFL props priced right now" freshness={freshness} arrow="miss" supportContext="nfl-props-empty">
            Books post the week&apos;s props a few days before kickoff.
          </EmptyState>
        </div>
      ) : (
        <>
          <NflPropsFinder slate={slate} />
          <div className="mt-6">
            <FreshnessStamp freshness={freshness} />
          </div>
        </>
      )}
    </div>
  );
}
