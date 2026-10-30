import type { Metadata } from "next";
import { getNbaPropsSlate, toWireSlate } from "@/lib/queries/nbaProps";
import { todayEt, isValidEtDate } from "@/lib/dateEt";
import { SportCarousel } from "@/components/book/SportCarousel";
import { SportTabs } from "@/components/book/SportTabs";
import { LeagueHeader, leagueTabs } from "@/components/book/LeaguePage";
import { DateStrip } from "@/components/book/DateStrip";
import { getLeagueDays } from "@/lib/queries/lobby";
import { EmptyState } from "@/components/EmptyState";
import { getFeedFreshness } from "@/lib/freshness";
import { NbaParlayFinder } from "@/components/nba/NbaParlayFinder";
import { refreshOnView } from "@/lib/ops/refreshOnView";

export const metadata: Metadata = {
  title: "NBA Parlay Finder — same-game legs that have hit together",
  description: "Same-game NBA parlays, 2 to 15 legs with alt lines, ranked by how often every leg has cashed together in the games the players shared.",
};

export const dynamic = "force-dynamic";

export default async function NbaParlaysPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const params = await searchParams;
  await refreshOnView([["sync-results-nba", 60], ["espn-props", 30]]);
  const days = await getLeagueDays("nba", todayEt());
  const date = params.date && isValidEtDate(params.date) ? params.date : (days[0] ?? todayEt());
  const [slate, freshness] = await Promise.all([getNbaPropsSlate(date), getFeedFreshness("nbaProps")]);
  const posted = slate.props.some((p) => p.quotes.length > 0);

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-24 pt-5 font-sans">
      <SportCarousel active="nba" />
      <LeagueHeader sport="nba" />
      <div className="mt-3">
        <SportTabs tabs={leagueTabs("nba", "parlays")} />
      </div>
      <div className="mt-4">
        <DateStrip days={days.includes(date) ? days : [date, ...days].sort()} active={date} href={(d) => `/nba/parlays?date=${d}`} />
      </div>
      {!posted ? (
        <div className="mt-8">
          <EmptyState title="No NBA props posted for this day" freshness={freshness} arrow="miss" supportContext="nba-parlays-empty">
            The finder builds parlays from the lines books hang; they post the morning of a game.
          </EmptyState>
        </div>
      ) : (
        <NbaParlayFinder slate={toWireSlate(slate)} />
      )}
    </div>
  );
}
