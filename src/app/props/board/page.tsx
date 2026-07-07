import Link from "next/link";
import { getPropBoard, listPropSports } from "@/lib/props/board";
import { PropBoard } from "@/components/PropBoard";
import { todayEt, shiftEtDate, isValidEtDate, formatEtDateLabel } from "@/lib/dateEt";

// Rides the daily game-log sync, so it changes day to day — render per request.
export const dynamic = "force-dynamic";

export default async function PropBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; stat?: string }>;
}) {
  const { date: dateParam, stat } = await searchParams;
  const date =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && isValidEtDate(dateParam) ? dateParam : todayEt();

  // Only MLB has prop data today; the framework is sport-agnostic (other sports
  // register a config in board.ts and appear here with their own stats/splits).
  const board = await getPropBoard("mlb", date, stat);
  const sports = listPropSports();

  const prevDate = shiftEtDate(date, -1);
  const nextDate = shiftEtDate(date, 1);

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 py-10 font-sans">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">Props Board</h1>
        <Link
          href="/props"
          className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
        >
          Browse by team →
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        The day&apos;s players ranked by hit rate — pick a stat, seek across each line, sort by any window or split.
        Live-odds EV lights up once paid props coverage is on.
      </p>

      {/* Sport selector — one sport today, built to hold every sport */}
      <div className="mt-5 flex items-center gap-2">
        {sports.map((s) => (
          <span
            key={s.sport}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
          >
            <span aria-hidden>{s.icon}</span>
            {s.label}
          </span>
        ))}
        <span className="text-xs text-muted-foreground">more sports coming</span>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Link
          href={`/props/board?date=${prevDate}${stat ? `&stat=${stat}` : ""}`}
          className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Prev day
        </Link>
        <span className="text-sm font-medium text-foreground">{formatEtDateLabel(date)}</span>
        <Link
          href={`/props/board?date=${nextDate}${stat ? `&stat=${stat}` : ""}`}
          className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
        >
          Next day →
        </Link>
      </div>

      <div className="mt-8">
        <PropBoard board={board} date={date} />
      </div>
    </div>
  );
}
