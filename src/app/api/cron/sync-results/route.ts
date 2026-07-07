import { checkCronAuth } from "@/lib/cronAuth";
import { isPollOddsStale, recordPollLog } from "@/lib/pollingPolicy";
import { syncMlbSchedule } from "@/lib/mlb/syncSchedule";
import { syncProbablePitchers } from "@/lib/mlb/syncPitchers";
import { pollAndStoreOdds } from "@/lib/odds/ingest";
import { syncRecentPlayerGameLogs } from "@/lib/props/syncGameLogs";
import { todayEt, shiftEtDate } from "@/lib/dateEt";

const JOB_NAME = "sync-results";
const PITCHERS_JOB_NAME = "sync-pitchers";
const POLL_ODDS_JOB_NAME = "poll-odds";
const GAME_LOGS_JOB_NAME = "sync-player-game-logs";

/**
 * Re-sync a few ET days back, not just "today". MLB games are ET-dated and
 * many finish after their date's UTC day has already rolled over — a
 * single-day window (worse: a single *UTC* day) never re-checks them once the
 * day passes, so a late finisher stays stuck at scheduled/live and is dropped
 * from every status=final query (team form's last-5/last-10, hit rates), which
 * silently slides those windows onto older games and skews Archer EV. Looking
 * back guarantees a late/boundary game reaches status=final within a cycle —
 * the same lesson syncRecentPlayerGameLogs already encodes (its LOOKBACK_DAYS).
 */
const RESULTS_LOOKBACK_DAYS = 3;

/** Free (MLB Stats API), run frequently to keep recent games' status/scores fresh. */
export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const endDate = todayEt();
  const startDate = shiftEtDate(endDate, -RESULTS_LOOKBACK_DAYS);

  try {
    const summary = await syncMlbSchedule(startDate, endDate);
    await recordPollLog(JOB_NAME, "ok");

    // Runs more frequently than sync-schedule, so this is where late-breaking
    // starter announcements/changes and post-start ERA updates get picked up.
    let pitchersSummary = null;
    try {
      // Probables are only meaningful for today's/upcoming games, so keep this single-day.
      pitchersSummary = await syncProbablePitchers(endDate, endDate);
      await recordPollLog(PITCHERS_JOB_NAME, "ok");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordPollLog(PITCHERS_JOB_NAME, `error: ${message}`);
    }

    // Self-heal: poll-odds.yml's own schedule can silently fail to fire at
    // all (confirmed happening — see pollingPolicy.ts's isPollOddsStale doc).
    // This 15-min free cron is the reliable one, so it doubles as the
    // catch-up path if a whole poll-odds cycle gets missed.
    let selfHealSummary = null;
    try {
      if (await isPollOddsStale(POLL_ODDS_JOB_NAME)) {
        selfHealSummary = await pollAndStoreOdds();
        await recordPollLog(
          POLL_ODDS_JOB_NAME,
          "ok (self-heal via sync-results)",
          selfHealSummary.creditsUsed,
          selfHealSummary.creditsRemaining
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordPollLog(POLL_ODDS_JOB_NAME, `error (self-heal via sync-results): ${message}`);
    }

    // Free (MLB Stats API) — feeds the prop hit-rate engine, independent of
    // (and much cheaper than) any odds polling. Looks back a few days on
    // its own (see syncRecentPlayerGameLogs) so a late finish can't get
    // stranded past this cycle's single-day window.
    let gameLogsSummary = null;
    try {
      gameLogsSummary = await syncRecentPlayerGameLogs();
      await recordPollLog(GAME_LOGS_JOB_NAME, "ok");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordPollLog(GAME_LOGS_JOB_NAME, `error: ${message}`);
    }

    return Response.json({
      startDate,
      endDate,
      ...summary,
      pitchers: pitchersSummary,
      selfHealPollOdds: selfHealSummary,
      playerGameLogs: gameLogsSummary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordPollLog(JOB_NAME, `error: ${message}`);
    return Response.json({ error: message }, { status: 502 });
  }
}
