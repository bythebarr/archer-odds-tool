import type { Metadata } from "next";
import Link from "next/link";
import { getUfcSlateItems } from "@/lib/queries/slate";
import { getOddsPoolForDate } from "@/lib/queries/oddsPool";
import { getPropBoard } from "@/lib/props/board";
import { todayEt, isValidEtDate } from "@/lib/dateEt";
import { getFeedFreshness } from "@/lib/freshness";
import { OddsPoolBoard } from "@/components/OddsPoolBoard";
import { SlateUfcStrip } from "@/components/SlateUfcStrip";
import { PropBoard } from "@/components/PropBoard";
import { PageShell, PageHeader } from "@/components/PageShell";
import { DateNav } from "@/components/DateNav";
import { InfoTip } from "@/components/InfoTip";
import { SportRail } from "@/components/SportRail";
import { refreshUpcomingUfcOnView } from "@/lib/ufc/refreshUpcoming";

// Fed by the daily result/schedule syncs, so the board changes day to day —
// render per request.
export const metadata: Metadata = {
  title: "The Slate — every priced play, one board",
  description:
    "Every day's priced plays in one pool. Line-shop the best price across books, filter by your odds range, and read value two ways: Market EV (best price vs the de-vigged line) or Archer's own Model projection.",
};

export const dynamic = "force-dynamic";

type Tab = "value" | "props";

const TABS: { key: Tab; label: string }[] = [
  { key: "value", label: "Value" },
  { key: "props", label: "Props" },
];

/**
 * The Slate — the flagship cross-sport surface. "Value" is the priced-play pool
 * (best price per bet across books + market/model value), with a compact UFC
 * strip riding alongside it (UFC has no book prices, so it can't be a priced
 * row). "Props" embeds the hit-rate board. The tab is a `?tab=` param (server
 * round-trip) so the Props board's own server-driven view/stat nav composes
 * cleanly; both carry the same date.
 */
export default async function SlatePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; tab?: string; view?: string; stat?: string }>;
}) {
  const { date: dateParam, tab: tabParam, view, stat } = await searchParams;
  const date =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && isValidEtDate(dateParam) ? dateParam : todayEt();
  const tab: Tab = tabParam === "props" ? "props" : "value";

  // Keep the upcoming-UFC feed fresh from the read side — Hobby crons are
  // unreliable, so this backfills after the response when the feed is stale.
  refreshUpcomingUfcOnView();

  // Only fetch the active tab's data — the tabs are independent queries. The
  // Value tab also pulls the day's UFC bouts for the strip beside the pool.
  const [pool, ufcStrip] =
    tab === "value"
      ? await Promise.all([getOddsPoolForDate(date), getUfcSlateItems(date)])
      : [null, null];
  // Only MLB has prop data today; getPropBoard is sport-agnostic (see board.ts).
  const propBoard = tab === "props" ? await getPropBoard("mlb", date, view, stat) : null;

  // Freshness for the active tab's dominant feed — reassures on empty boards.
  const freshness =
    tab === "props" ? await getFeedFreshness("props") : await getFeedFreshness("mlbOdds");

  // Preserve the active tab (and, on Props, its view) across day nav so
  // prev/next doesn't bounce you back to the default tab / stat view.
  const navSuffix = tab === "props" ? `&tab=props&view=${propBoard!.activeView}` : "";

  return (
    <PageShell width="3xl">
      <PageHeader
        title="Slate"
        right={
          <Link
            href={`/mlb?date=${date}`}
            className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
          >
            Shop all MLB lines →
          </Link>
        }
        description={
          <>
            Every priced play in one <InfoTip id="pool">pool</InfoTip>. Drag the odds range to your price band,
            then read value two ways: <span className="text-foreground/70">Market</span> (best price vs the{" "}
            <InfoTip id="de-vig">de-vigged</InfoTip> market) or <span className="text-foreground/70">Model</span>{" "}
            (Archer&apos;s own projection vs the price). The <span className="text-foreground/70">Props</span> tab
            holds the hit-rate board.
          </>
        }
      />

      {/* Quick-jump to any sport + the All Sports lobby */}
      <div className="mt-5">
        <SportRail date={date} />
      </div>

      {/* Value | Props — the two halves of the Slate under one date nav */}
      <div className="mt-5 inline-flex rounded-lg bg-muted p-0.5">
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Link
              key={t.key}
              href={t.key === "value" ? `/slate?date=${date}` : `/slate?date=${date}&tab=${t.key}`}
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

      <DateNav basePath="/slate" date={date} extraQuery={navSuffix} />

      <div className="mt-8">
        {tab === "value" ? (
          <>
            <SlateUfcStrip items={ufcStrip!} />
            <OddsPoolBoard pool={pool!} freshness={freshness} />
          </>
        ) : (
          <PropBoard board={propBoard!} date={date} basePath="/slate" extraQuery="&tab=props" freshness={freshness} />
        )}
      </div>
    </PageShell>
  );
}
