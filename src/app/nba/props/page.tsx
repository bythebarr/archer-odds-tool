import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getNbaPropsSlate } from "@/lib/queries/nbaProps";
import { NBA_PROP_STAT_BY_KEY } from "@/lib/nba/propStats";
import { todayEt, isValidEtDate } from "@/lib/dateEt";
import { getFeedFreshness } from "@/lib/freshness";
import { PageShell, PageHeader } from "@/components/PageShell";
import { DateNav } from "@/components/DateNav";
import { EmptyState } from "@/components/EmptyState";
import { FreshnessStamp } from "@/components/FreshnessStamp";
import { NbaPropsFinder, PROPS_PREFS_COOKIE, type PropsPrefs } from "@/components/nba/NbaPropsFinder";
import type { NbaPropStat } from "@/generated/prisma/client";

export const metadata: Metadata = {
  title: "NBA Props — best price and hit rate at every line",
  description:
    "NBA player props: the best Over and Under across sportsbooks at the main line, next to how often each player has cleared it.",
};

export const dynamic = "force-dynamic";

const DEFAULT_PREFS: PropsPrefs = { stat: "points", side: "over", sort: "hitRate" };

/** URL params win (a shared link), then the remembered cookie, then defaults. */
function resolvePrefs(params: Record<string, string | undefined>, cookie: string | undefined): PropsPrefs {
  let saved: Partial<PropsPrefs> = {};
  try {
    saved = cookie ? (JSON.parse(cookie) as Partial<PropsPrefs>) : {};
  } catch {
    saved = {};
  }
  const stat = [params.stat, saved.stat].find((s) => NBA_PROP_STAT_BY_KEY.has(s as NbaPropStat)) as NbaPropStat | undefined;
  const side = [params.side, saved.side].find((s) => s === "over" || s === "under") as PropsPrefs["side"] | undefined;
  const sort = [params.sort, saved.sort].find((s) => s === "hitRate" || s === "margin" || s === "price") as
    | PropsPrefs["sort"]
    | undefined;
  return { stat: stat ?? DEFAULT_PREFS.stat, side: side ?? DEFAULT_PREFS.side, sort: sort ?? DEFAULT_PREFS.sort };
}

export default async function NbaPropsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; stat?: string; side?: string; sort?: string; game?: string }>;
}) {
  const params = await searchParams;
  const date = params.date && isValidEtDate(params.date) ? params.date : todayEt();
  const prefs = resolvePrefs(params, (await cookies()).get(PROPS_PREFS_COOKIE)?.value);

  const [slate, freshness] = await Promise.all([getNbaPropsSlate(date), getFeedFreshness("nbaProps")]);
  const initialGame = params.game && slate.games.some((g) => g.id === params.game) ? params.game : null;

  return (
    <PageShell width="2xl">
      <PageHeader
        title="NBA Props"
        description="Best price across books at the main line, next to how often each player cleared it."
        right={
          <Link href="/nba" className="text-xs text-muted-foreground underline underline-offset-2">
            Game lines →
          </Link>
        }
      />

      <DateNav basePath="/nba/props" date={date} />

      {slate.props.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="No NBA props priced for this day" freshness={freshness} arrow="miss" supportContext="nba-props-empty">
            Books post NBA props the morning of a game and pull them at tip-off.
          </EmptyState>
        </div>
      ) : (
        <>
          <NbaPropsFinder slate={slate} initial={prefs} initialGame={initialGame} />
          <div className="mt-6">
            <FreshnessStamp freshness={freshness} />
          </div>
        </>
      )}
    </PageShell>
  );
}
