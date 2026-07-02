import Link from "next/link";
import { listGames } from "@/lib/queries/games";
import { todayEt, shiftEtDate } from "@/lib/dateEt";

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(date);
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: dateParam } = await searchParams;
  const date = dateParam ?? todayEt();
  const games = await listGames(date);

  const prevDate = shiftEtDate(date, -1);
  const nextDate = shiftEtDate(date, 1);

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10 font-sans">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        archer-odds-tool
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
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

      <ul className="mt-6 divide-y divide-zinc-200 dark:divide-zinc-800">
        {games.length === 0 && (
          <li className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No games scheduled for this date.
          </li>
        )}
        {games.map((g) => (
          <li key={g.id}>
            <Link
              href={`/games/${g.id}`}
              className="flex items-center justify-between py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <div className="flex flex-col">
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {g.awayTeam.abbreviation} @ {g.homeTeam.abbreviation}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {g.awayTeam.name} at {g.homeTeam.name}
                </span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-sm text-zinc-900 dark:text-zinc-50">
                  {formatTime(g.scheduledStartUtc)} ET
                </span>
                <span className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
                  {g.status}
                  {g.status !== "scheduled" && g.homeScore !== null && g.awayScore !== null
                    ? ` · ${g.awayScore}-${g.homeScore}`
                    : ""}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
