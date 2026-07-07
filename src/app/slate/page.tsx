import Link from "next/link";
import { listGamesWithLinesForDate } from "@/lib/queries/games";
import { getTeamHitRatesBatch } from "@/lib/queries/hitRate";
import { getGameMatchupsBatch } from "@/lib/queries/matchup";
import { computeArcherWinProbability } from "@/lib/archer/winProbability";
import { computeExpectedRuns, type ExpectedRuns } from "@/lib/archer/expectedRuns";
import { todayEt, shiftEtDate, isValidEtDate } from "@/lib/dateEt";
import { SlateLinesView } from "@/components/SlateLinesView";

export default async function SlatePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: dateParam } = await searchParams;
  const date =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && isValidEtDate(dateParam)
      ? dateParam
      : todayEt();

  const gamesWithLines = await listGamesWithLinesForDate(date);

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

  const prevDate = shiftEtDate(date, -1);
  const nextDate = shiftEtDate(date, 1);

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 py-10 font-sans">
      <h1 className="text-xl font-semibold text-foreground">Full slate odds</h1>
      <p className="text-sm text-muted-foreground">
        Every book&apos;s line across the day&apos;s games, filterable by price range.
      </p>

      <div className="mt-6 flex items-center justify-between">
        <Link
          href={`/slate?date=${prevDate}`}
          className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Prev day
        </Link>
        <span className="text-sm font-medium text-foreground">{date}</span>
        <Link
          href={`/slate?date=${nextDate}`}
          className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
        >
          Next day →
        </Link>
      </div>

      {gamesWithLines.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          No games scheduled for this date.
        </p>
      ) : (
        <div className="mt-8">
          <SlateLinesView
            gamesWithLines={gamesWithLines}
            hitRatesByTeam={hitRatesByTeam}
            archerProbByGame={archerProbByGame}
            archerRunsByGame={archerRunsByGame}
          />
        </div>
      )}
    </div>
  );
}
