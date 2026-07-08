import Link from "next/link";
import { getSlateForDate } from "@/lib/queries/slate";
import { getPropBoard } from "@/lib/props/board";
import { todayEt, shiftEtDate, isValidEtDate, formatEtDateLabel } from "@/lib/dateEt";
import { SlateBoard } from "@/components/SlateBoard";
import { PropBoard } from "@/components/PropBoard";
import { refreshUpcomingUfcOnView } from "@/lib/ufc/refreshUpcoming";

// Fed by the daily result/schedule syncs, so the board changes day to day —
// render per request.
export const dynamic = "force-dynamic";

type Tab = "lines" | "props";

const TABS: { key: Tab; label: string }[] = [
  { key: "lines", label: "Lines" },
  { key: "props", label: "Props" },
];

/**
 * The Slate — the flagship cross-sport surface. Two halves under one date nav:
 * "Lines" is the game-line board (every sport's matchup + model lean), "Props"
 * embeds the hit-rate board. The tab is a `?tab=` param (server round-trip) so
 * the Props board's own server-driven view/stat nav composes cleanly; both
 * carry the same date. Convergence step toward the one master search surface.
 */
export default async function SlatePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; tab?: string; view?: string; stat?: string }>;
}) {
  const { date: dateParam, tab: tabParam, view, stat } = await searchParams;
  const date =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && isValidEtDate(dateParam) ? dateParam : todayEt();
  const tab: Tab = tabParam === "props" ? "props" : "lines";

  // Keep the upcoming-UFC feed fresh from the read side — Hobby crons are
  // unreliable, so this backfills after the response when the feed is stale.
  refreshUpcomingUfcOnView();

  // Only fetch the active tab's data — the two halves are independent queries.
  const slate = tab === "lines" ? await getSlateForDate(date) : null;
  // Only MLB has prop data today; getPropBoard is sport-agnostic (see board.ts).
  const propBoard = tab === "props" ? await getPropBoard("mlb", date, view, stat) : null;

  // Preserve the active tab (and, on Props, its view) across day nav so
  // prev/next doesn't bounce you back to Lines / the default stat view.
  const navSuffix =
    tab === "props" ? `&tab=props&view=${propBoard!.activeView}` : "";
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
        The whole day&apos;s card across every sport in one place. Model lean and hit rate are the free signals;
        live-odds EV lights up once paid odds coverage is on.
      </p>

      {/* Lines | Props — the two halves of the Slate under one date nav */}
      <div className="mt-5 inline-flex rounded-lg bg-muted p-0.5">
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Link
              key={t.key}
              href={t.key === "lines" ? `/slate?date=${date}` : `/slate?date=${date}&tab=props`}
              scroll={false}
              aria-current={active ? "page" : undefined}
              className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-colors ${
                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Link
          href={`/slate?date=${prevDate}${navSuffix}`}
          className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Prev day
        </Link>
        <span className="text-sm font-medium text-foreground">{formatEtDateLabel(date)}</span>
        <Link
          href={`/slate?date=${nextDate}${navSuffix}`}
          className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
        >
          Next day →
        </Link>
      </div>

      <div className="mt-8">
        {tab === "lines" ? (
          <SlateBoard slate={slate!} />
        ) : (
          <PropBoard board={propBoard!} date={date} basePath="/slate" extraQuery="&tab=props" />
        )}
      </div>
    </div>
  );
}
