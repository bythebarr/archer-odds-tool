import Link from "next/link";
import type { Metadata } from "next";
import { listGamesWithLinesForDate } from "@/lib/queries/games";
import { todayEt, shiftEtDate, isValidEtDate, formatEtDateLabel } from "@/lib/dateEt";
import { HomeGamesList } from "@/components/HomeGamesList";

export const metadata: Metadata = {
  title: "MLB",
  description: "MLB odds line-shopping — research/discovery only, no bet placement or tracking.",
};

export default async function MlbGamesPage({
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
      <h1 className="text-xl font-semibold text-foreground">MLB Games</h1>
      <p className="text-sm text-muted-foreground">
        MLB odds line-shopping — research/discovery only, no bet placement or tracking.
      </p>

      <div className="mt-6 flex items-center justify-between">
        <Link
          href={`/mlb?date=${prevDate}`}
          className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Prev day
        </Link>
        <span className="text-sm font-medium text-foreground">{formatEtDateLabel(date)}</span>
        <Link
          href={`/mlb?date=${nextDate}`}
          className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
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
