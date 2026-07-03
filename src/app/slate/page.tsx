import Link from "next/link";
import { listGamesWithLinesForDate } from "@/lib/queries/games";
import { getTeamHitRatesBatch } from "@/lib/queries/hitRate";
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

  const prevDate = shiftEtDate(date, -1);
  const nextDate = shiftEtDate(date, 1);

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 py-10 font-sans">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Full slate odds</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Every book&apos;s line across the day&apos;s games, filterable by price range.
      </p>

      <div className="mt-6 flex items-center justify-between">
        <Link
          href={`/slate?date=${prevDate}`}
          className="text-sm font-medium text-zinc-600 hover:underline dark:text-zinc-400"
        >
          ← Prev day
        </Link>
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{date}</span>
        <Link
          href={`/slate?date=${nextDate}`}
          className="text-sm font-medium text-zinc-600 hover:underline dark:text-zinc-400"
        >
          Next day →
        </Link>
      </div>

      {gamesWithLines.length === 0 ? (
        <p className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
          No games scheduled for this date.
        </p>
      ) : (
        <div className="mt-8">
          <SlateLinesView gamesWithLines={gamesWithLines} hitRatesByTeam={hitRatesByTeam} />
        </div>
      )}
    </div>
  );
}
