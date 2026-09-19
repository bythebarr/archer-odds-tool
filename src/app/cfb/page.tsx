import type { Metadata } from "next";
import { todayEt, isValidEtDate, etDayBoundsUtc } from "@/lib/dateEt";
import { fetchCfbDateSlate, fetchCfbSeasonThrough } from "@/lib/cfb/espnScoreboard";
import { buildTeamRatings, ratingOrDefault } from "@/lib/cfb/ratings";
import { predictGame } from "@/lib/cfb/model";
import { CfbGameCard } from "@/components/cfb/CfbGameCard";
import { PageShell, PageHeader } from "@/components/PageShell";
import { DateNav } from "@/components/DateNav";
import { EmptyState } from "@/components/EmptyState";

// No DB/cron behind this board (CFB v0 is deliberately DB-free — see
// docs/architecture/CFB-V0.md), so it must fetch and compute fresh per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CFB — experimental baseline (v0)",
  description:
    "College football research board: an unvalidated baseline model (points scored/allowed, opponent-adjusted) plus a local, browser-only market-line comparison. Not a proven betting product.",
};

/** Bowl-season games in January belong to the prior fall's season. */
function seasonForDate(dateEt: string): number {
  const year = Number(dateEt.slice(0, 4));
  const month = Number(dateEt.slice(5, 7));
  return month === 1 ? year - 1 : year;
}

export default async function CfbPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: dateParam } = await searchParams;
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && isValidEtDate(dateParam) ? dateParam : todayEt();

  const asOfUtc = etDayBoundsUtc(date).gte; // start of the browsed ET day — one shared, conservative, leakage-safe cutoff for every game shown
  const season = seasonForDate(date);

  // Nothing behind this page can fabricate data on failure (no DB, no cache
  // of a prior good response), so each of the two independent ESPN fetches
  // is tracked separately (allSettled, not Promise.all) rather than folded
  // into one generic "fetch failed" flag:
  //   - the daily slate failing means there's nothing to render at all — an
  //     honest "couldn't load" empty state, not Next's generic error page.
  //   - the season-history fetch failing is a DIFFERENT, more subtle case: the
  //     slate can still render (real teams/kickoffs/scores), but
  //     buildTeamRatings([], ...) produces the exact same empty ratings map a
  //     genuinely early, historyless season would — so without flagging it
  //     explicitly, a transient history-fetch failure would silently render
  //     as if it were normal early-season sparsity instead of a fetch error.
  const [slateResult, seasonGamesResult] = await Promise.allSettled([
    fetchCfbDateSlate(date),
    fetchCfbSeasonThrough(season, asOfUtc),
  ]);
  const slateFetchFailed = slateResult.status === "rejected";
  const slate = slateResult.status === "fulfilled" ? slateResult.value : [];
  const historyFetchFailed = seasonGamesResult.status === "rejected";
  const seasonGames = seasonGamesResult.status === "fulfilled" ? seasonGamesResult.value : [];

  const { ratings, leagueAvgPoints } = buildTeamRatings(seasonGames, asOfUtc);

  return (
    <PageShell width="2xl">
      <PageHeader
        title="CFB"
        description="Experimental college-football baseline — an unvalidated points-based model, plus a local market-line comparison."
      />

      <div className="mt-4 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-200">
        <p className="font-semibold uppercase tracking-wide">Experimental CFB baseline — v0</p>
        <p className="mt-1">
          Not yet calibrated against historical closing lines. Every model constant below is a named heuristic, not a
          fitted parameter — see docs/architecture/CFB-V0.md. Injuries, player availability, weather, transfers,
          coordinator changes, and detailed matchup data are not yet incorporated. This is research context, not a
          pick, a lock, or a proven edge.
        </p>
      </div>

      <DateNav basePath="/cfb" date={date} />

      {slateFetchFailed ? (
        <EmptyState title="Couldn't load today's CFB schedule" arrow="miss" supportContext="cfb-slate-fetch-failed">
          ESPN&apos;s scoreboard didn&apos;t respond. This is a live fetch failure, not an empty slate — try
          reloading in a moment rather than assuming there are no games today.
        </EmptyState>
      ) : slate.length === 0 ? (
        <EmptyState title="No FBS games on this date" arrow="miss" supportContext="cfb-empty">
          Try a Saturday during the season — CFB plays mostly on Saturdays, with a few Tuesday/Wednesday/Friday games.
        </EmptyState>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {historyFetchFailed ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              Couldn&apos;t load season history from ESPN — the projections below are NOT genuine early-season
              estimates, they&apos;re a fetch failure showing as zero-sample defaults. Reload to retry; today&apos;s
              schedule above is unaffected.
            </div>
          ) : null}
          {slate.map((game) => {
            const homeRating = ratingOrDefault(ratings, game.home.espnTeamId);
            const awayRating = ratingOrDefault(ratings, game.away.espnTeamId);
            const prediction = predictGame(homeRating, awayRating, leagueAvgPoints, { neutralSite: game.neutralSite });
            return (
              <CfbGameCard
                key={game.espnEventId}
                espnEventId={game.espnEventId}
                startUtc={game.startUtc}
                status={game.status}
                neutralSite={game.neutralSite}
                home={game.home}
                away={game.away}
                homeScore={game.homeScore}
                awayScore={game.awayScore}
                prediction={prediction}
              />
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
