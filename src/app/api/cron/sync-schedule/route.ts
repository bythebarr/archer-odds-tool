import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { syncMlbSchedule, purgePreseasonGames } from "@/lib/mlb/syncSchedule";
import { syncProbablePitchers } from "@/lib/mlb/syncPitchers";
import { todayEt, shiftEtDate } from "@/lib/dateEt";
import { classifyFetchStore, ingestHttpStatus, pollLogStatus, summaryForCaughtError } from "@/lib/engine/ingestResult";

const JOB_NAME = "sync-schedule";
const PITCHERS_JOB_NAME = "sync-pitchers";
const PURGE_JOB_NAME = "purge-preseason-games";

/**
 * How many ET days back this daily sync re-checks. This is the reliable
 * healer for stranded games: sync-results (which normally keeps recent games
 * fresh) is driven only by a GitHub Actions schedule that's been observed to
 * silently not fire for a day+, so if a late/boundary game never got
 * finalized, this Vercel cron re-syncs the recent past every day and closes
 * the gap. Wider than sync-results' own lookback to cover a multi-day outage.
 */
const HEAL_LOOKBACK_DAYS = 7;

/**
 * Free (MLB Stats API), run once daily. Extends the schedule window forward
 * AND re-checks the last HEAL_LOOKBACK_DAYS so recently-completed games that
 * finalized late reach status=final (see the sync-results lookback for why
 * that matters — stale finals skew team form + Archer EV). `start`/`end`
 * query params optionally override the default window — e.g. for a one-time
 * historical backfill (production env vars are Vercel "Sensitive" values,
 * unreadable outside a running deployment, so a manual script can't hit the
 * prod DB directly — this route is the way in). Probable pitchers are only
 * ever synced for the normal forward window regardless of the override, since
 * historical games don't have probable starters.
 */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const today = todayEt();
  const forwardEnd = shiftEtDate(today, 6);
  const startDate = url.searchParams.get("start") ?? shiftEtDate(today, -HEAL_LOOKBACK_DAYS);
  const endDate = url.searchParams.get("end") ?? forwardEnd;

  try {
    const summary = await syncMlbSchedule(startDate, endDate);
    // Zero games fetched for [startDate, endDate] is a legitimate empty
    // result (e.g. entirely off-season), but a nonzero fetch that upserts
    // zero games (every game failed the team-match check) is not.
    const outcome = classifyFetchStore(
      { fetched: summary.gamesFetched, stored: summary.gamesUpserted },
      { noun: "games" }
    );
    await recordPollLog(JOB_NAME, pollLogStatus(outcome));

    // Separate try/catch: a pitcher-sync hiccup shouldn't mark the
    // already-succeeded schedule sync as failed.
    let pitchersSummary = null;
    try {
      pitchersSummary = await syncProbablePitchers(today, forwardEnd);
      await recordPollLog(PITCHERS_JOB_NAME, "ok");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordPollLog(PITCHERS_JOB_NAME, `error: ${message}`);
    }

    // Idempotent one-time cleanup of pre-season/exhibition games mistakenly
    // stored as regular-season finals (see purgePreseasonGames). No-ops once
    // clean; own try/catch so it can't fail the schedule sync.
    let purgeSummary = null;
    try {
      purgeSummary = await purgePreseasonGames();
      await recordPollLog(
        PURGE_JOB_NAME,
        purgeSummary.gamesPurged === 0
          ? "ok"
          : `ok (purged ${purgeSummary.gamesPurged} games, ${purgeSummary.logsPurged} logs)`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordPollLog(PURGE_JOB_NAME, `error: ${message}`);
    }

    return Response.json(
      { status: outcome.status, detail: outcome.detail, startDate, endDate, ...summary, pitchers: pitchersSummary, purge: purgeSummary },
      { status: ingestHttpStatus(outcome.status) }
    );
  } catch (error) {
    const summary = summaryForCaughtError("mlb", error);
    await recordPollLog(JOB_NAME, pollLogStatus(summary));
    return Response.json(summary, { status: ingestHttpStatus(summary.status) });
  }
}
