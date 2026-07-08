import Link from "next/link";
import { getSlateForDate } from "@/lib/queries/slate";
import { getOddsPoolForDate } from "@/lib/queries/oddsPool";
import { getPropBoard } from "@/lib/props/board";
import { todayEt, isValidEtDate } from "@/lib/dateEt";
import { OddsPoolBoard } from "@/components/OddsPoolBoard";
import { SlateBoard } from "@/components/SlateBoard";
import { PropBoard } from "@/components/PropBoard";
import { PageShell, PageHeader } from "@/components/PageShell";
import { DateNav } from "@/components/DateNav";
import { InfoTip } from "@/components/InfoTip";
import { SportRail } from "@/components/SportRail";
import { refreshUpcomingUfcOnView } from "@/lib/ufc/refreshUpcoming";

// Fed by the daily result/schedule syncs, so the board changes day to day —
// render per request.
export const dynamic = "force-dynamic";

type Tab = "value" | "lines" | "props";

const TABS: { key: Tab; label: string }[] = [
  { key: "value", label: "Value" },
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
  const tab: Tab = tabParam === "lines" ? "lines" : tabParam === "props" ? "props" : "value";

  // Keep the upcoming-UFC feed fresh from the read side — Hobby crons are
  // unreliable, so this backfills after the response when the feed is stale.
  refreshUpcomingUfcOnView();

  // Only fetch the active tab's data — the tabs are independent queries.
  const pool = tab === "value" ? await getOddsPoolForDate(date) : null;
  const slate = tab === "lines" ? await getSlateForDate(date) : null;
  // Only MLB has prop data today; getPropBoard is sport-agnostic (see board.ts).
  const propBoard = tab === "props" ? await getPropBoard("mlb", date, view, stat) : null;

  // Preserve the active tab (and, on Props, its view) across day nav so
  // prev/next doesn't bounce you back to the default tab / stat view.
  const navSuffix =
    tab === "props" ? `&tab=props&view=${propBoard!.activeView}` : tab === "lines" ? "&tab=lines" : "";

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
            (Archer&apos;s own projection vs the price). <span className="text-foreground/70">Lines</span> and{" "}
            <span className="text-foreground/70">Props</span> hold the deeper model-lean and hit-rate views.
          </>
        }
      />

      {/* Quick-jump to any sport + the All Sports lobby */}
      <div className="mt-5">
        <SportRail date={date} />
      </div>

      {/* Lines | Props — the two halves of the Slate under one date nav */}
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
          <OddsPoolBoard pool={pool!} />
        ) : tab === "lines" ? (
          <SlateBoard slate={slate!} />
        ) : (
          <PropBoard board={propBoard!} date={date} basePath="/slate" extraQuery="&tab=props" />
        )}
      </div>
    </PageShell>
  );
}
