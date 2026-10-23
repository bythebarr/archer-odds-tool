import type { Metadata } from "next";
import { getNbaPropsSlate } from "@/lib/queries/nbaProps";
import { todayEt, isValidEtDate } from "@/lib/dateEt";
import { getFeedFreshness } from "@/lib/freshness";
import { SportCarousel } from "@/components/book/SportCarousel";
import { SportTabs } from "@/components/book/SportTabs";
import { LeagueHeader, leagueTabs } from "@/components/book/LeaguePage";
import { DateStrip } from "@/components/book/DateStrip";
import { getLeagueDays } from "@/lib/queries/lobby";
import { EmptyState } from "@/components/EmptyState";
import { FreshnessStamp } from "@/components/FreshnessStamp";
import { NbaPropsFinder } from "@/components/nba/NbaPropsFinder";
import { readPropsPrefs } from "@/lib/nba/propsPrefs";

export const metadata: Metadata = {
  title: "NBA Props — best price and hit rate at every line",
  description:
    "NBA player props: the best Over and Under across sportsbooks at the main line, next to how often each player has cleared it.",
};

export const dynamic = "force-dynamic";

export default async function NbaPropsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; stat?: string; side?: string; sort?: string; game?: string }>;
}) {
  const params = await searchParams;
  const days = await getLeagueDays("nba", todayEt());
  const date = params.date && isValidEtDate(params.date) ? params.date : (days[0] ?? todayEt());
  const prefs = await readPropsPrefs(params);

  const [slate, freshness] = await Promise.all([getNbaPropsSlate(date), getFeedFreshness("nbaProps")]);
  const initialGame = params.game && slate.games.some((g) => g.id === params.game) ? params.game : null;

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-10 pt-5 font-sans">
      <SportCarousel active="nba" />
      <LeagueHeader sport="nba" />
      <div className="mt-3">
        <SportTabs tabs={leagueTabs("nba", "props")} />
      </div>

      <div className="mt-4">
        <DateStrip days={days.includes(date) ? days : [date, ...days].sort()} active={date} href={(d) => `/nba/props?date=${d}`} />
      </div>

      {slate.props.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="No NBA props priced for this day" freshness={freshness} arrow="miss" supportContext="nba-props-empty">
            Books post NBA props the morning of a game and pull them at tip-off.
          </EmptyState>
        </div>
      ) : (
        <>
          <NbaPropsFinder slate={slate} initial={prefs} initialGame={initialGame} />
          <div className="mt-6">
            <FreshnessStamp freshness={freshness} />
          </div>
        </>
      )}
    </div>
  );
}
