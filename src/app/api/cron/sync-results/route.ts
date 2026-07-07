import { checkCronAuth } from "@/lib/cronAuth";
import { isPollOddsStale, recordPollLog } from "@/lib/pollingPolicy";
import { syncMlbSchedule } from "@/lib/mlb/syncSchedule";
import { syncProbablePitchers } from "@/lib/mlb/syncPitchers";
import { pollAndStoreOdds } from "@/lib/odds/ingest";
import { syncRecentPlayerGameLogs } from "@/lib/props/syncGameLogs";

const JOB_NAME = "sync-results";
const PITCHERS_JOB_NAME = "sync-pitchers";
const POLL_ODDS_JOB_NAME = "poll-odds";
const GAME_LOGS_JOB_NAME = "sync-player-game-logs";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Free (MLB Stats API), run frequently to keep today's game status/scores fresh. */
export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const date = todayUtc();

  try {
    const summary = await syncMlbSchedule(date, date);
    await recordPollLog(JOB_NAME, "ok");

    // Runs more frequently than sync-schedule, so this is where late-breaking
    // starter announcements/changes and post-start ERA updates get picked up.
    let pitchersSummary = null;
    try {
      pitchersSummary = await syncProbablePitchers(date, date);
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
      date,
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
