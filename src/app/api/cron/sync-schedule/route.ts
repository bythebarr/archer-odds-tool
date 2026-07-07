import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { syncMlbSchedule } from "@/lib/mlb/syncSchedule";
import { syncProbablePitchers } from "@/lib/mlb/syncPitchers";
import { todayEt, shiftEtDate } from "@/lib/dateEt";

const JOB_NAME = "sync-schedule";
const PITCHERS_JOB_NAME = "sync-pitchers";

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
    await recordPollLog(JOB_NAME, "ok");

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

    return Response.json({ startDate, endDate, ...summary, pitchers: pitchersSummary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordPollLog(JOB_NAME, `error: ${message}`);
    return Response.json({ error: message }, { status: 502 });
  }
}
