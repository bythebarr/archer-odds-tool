import Link from "next/link";
import { getSlateForDate } from "@/lib/queries/slate";
import { todayEt, shiftEtDate, isValidEtDate, formatEtDateLabel } from "@/lib/dateEt";
import { SlateBoard } from "@/components/SlateBoard";

// Fed by the daily result/schedule syncs, so the board changes day to day —
// render per request.
export const dynamic = "force-dynamic";

export default async function SlatePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: dateParam } = await searchParams;
  const date =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && isValidEtDate(dateParam) ? dateParam : todayEt();

  const slate = await getSlateForDate(date);

  const prevDate = shiftEtDate(date, -1);
  const nextDate = shiftEtDate(date, 1);

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 py-10 font-sans">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">Slate</h1>
        <Link
          href={`/slate/mlb?date=${date}`}
          className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
        >
          Shop all MLB lines →
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        The whole day&apos;s card across every sport in one place. Model lean is the free Archer signal; live-odds EV
        lights up once paid odds coverage is on.
      </p>

      <div className="mt-6 flex items-center justify-between">
        <Link
          href={`/slate?date=${prevDate}`}
          className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Prev day
        </Link>
        <span className="text-sm font-medium text-foreground">{formatEtDateLabel(date)}</span>
        <Link
          href={`/slate?date=${nextDate}`}
          className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
        >
          Next day →
        </Link>
      </div>

      <div className="mt-8">
        <SlateBoard slate={slate} />
      </div>
    </div>
  );
}
