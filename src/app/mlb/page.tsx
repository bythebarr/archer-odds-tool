import type { Metadata } from "next";
import { listGamesWithLinesForDate } from "@/lib/queries/games";
import { getTeamHitRatesBatch } from "@/lib/queries/hitRate";
import { getGameMatchupsBatch } from "@/lib/queries/matchup";
import { computeArcherWinProbability } from "@/lib/archer/winProbability";
import { computeExpectedRuns, type ExpectedRuns } from "@/lib/archer/expectedRuns";
import { todayEt, isValidEtDate } from "@/lib/dateEt";
import { SlateLinesView } from "@/components/SlateLinesView";
import { PageShell, PageHeader } from "@/components/PageShell";
import { DateNav } from "@/components/DateNav";
import { EmptyState } from "@/components/EmptyState";
import { FreshnessStamp } from "@/components/FreshnessStamp";
import { getFeedFreshness } from "@/lib/freshness";

export const metadata: Metadata = {
  title: "MLB",
  description: "MLB odds line-shopping across every book, with Archer's model lean.",
};

// The one canonical MLB board — every book's line per game, filterable by price,
// with hit-rate + model-lean columns. (Formerly split across /mlb and
// /slate/mlb; the latter now redirects here.)
export default async function MlbPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: dateParam } = await searchParams;
  const date =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && isValidEtDate(dateParam) ? dateParam : todayEt();

  const [gamesWithLines, freshness] = await Promise.all([
    listGamesWithLinesForDate(date),
    getFeedFreshness("mlbOdds"),
  ]);

  const teamIds = new Set<string>();
  for (const { game } of gamesWithLines) {
    teamIds.add(game.homeTeam.id);
    teamIds.add(game.awayTeam.id);
  }
  const hitRatesByTeam = await getTeamHitRatesBatch([...teamIds]);

  const matchupsByGame = await getGameMatchupsBatch(gamesWithLines.map(({ game }) => game.id));
  const archerProbByGame: Record<string, { home: number | null; away: number | null } | null> = {};
  const archerRunsByGame: Record<string, ExpectedRuns | null> = {};
  for (const [gameId, matchup] of Object.entries(matchupsByGame)) {
    if (!matchup) {
      archerProbByGame[gameId] = null;
      archerRunsByGame[gameId] = null;
      continue;
    }
    const { homeProb, awayProb } = computeArcherWinProbability(matchup);
    archerProbByGame[gameId] = { home: homeProb, away: awayProb };
    archerRunsByGame[gameId] = computeExpectedRuns(matchup);
  }

  return (
    <PageShell width="3xl">
      <PageHeader
        title="MLB"
        description="Every book's line across the day's games, filterable by price — with Archer's model lean."
      />

      <DateNav basePath="/mlb" date={date} />

      {gamesWithLines.length === 0 ? (
        <EmptyState
          title="No MLB lines to show yet"
          freshness={freshness}
          arrow="miss"
          supportContext="mlb-empty"
        >
          Odds for this date haven&apos;t posted, or there are no games scheduled.
        </EmptyState>
      ) : (
        <div className="mt-8">
          <div className="mb-3 flex justify-end">
            <FreshnessStamp freshness={freshness} />
          </div>
          <SlateLinesView
            gamesWithLines={gamesWithLines}
            hitRatesByTeam={hitRatesByTeam}
            archerProbByGame={archerProbByGame}
            archerRunsByGame={archerRunsByGame}
          />
        </div>
      )}
    </PageShell>
  );
}
