import Link from "next/link";
import { listGamesWithLinesForDate } from "@/lib/queries/games";
import { todayEt, shiftEtDate, isValidEtDate } from "@/lib/dateEt";
import { HomeGamesList } from "@/components/HomeGamesList";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: dateParam } = await searchParams;
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && isValidEtDate(dateParam)
    ? dateParam
    : todayEt();
  const gamesWithLines = await listGamesWithLinesForDate(date);

  const prevDate = shiftEtDate(date, -1);
  const nextDate = shiftEtDate(date, 1);

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        MLB odds line-shopping — research/discovery only, no bet placement or tracking.
      </p>

      <div className="mt-6 flex items-center justify-between">
        <Link
          href={`/?date=${prevDate}`}
          className="text-sm font-medium text-zinc-600 hover:underline dark:text-zinc-400"
        >
          ← Prev day
        </Link>
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{date}</span>
        <Link
          href={`/?date=${nextDate}`}
          className="text-sm font-medium text-zinc-600 hover:underline dark:text-zinc-400"
        >
          Next day →
        </Link>
      </div>

      <div className="mt-6">
        <HomeGamesList gamesWithLines={gamesWithLines} />
      </div>
    </div>
  );
}
