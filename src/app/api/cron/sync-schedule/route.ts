import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { syncMlbSchedule } from "@/lib/mlb/syncSchedule";
import { syncProbablePitchers } from "@/lib/mlb/syncPitchers";
import { todayEt, shiftEtDate } from "@/lib/dateEt";

const JOB_NAME = "sync-schedule";
const PITCHERS_JOB_NAME = "sync-pitchers";

/**
 * Free (MLB Stats API), run once daily to extend the schedule window
 * forward. `start`/`end` query params optionally override the default
 * today..+6 window — e.g. for a one-time historical backfill (used to
 * populate team-form data; production env vars are Vercel "Sensitive"
 * values, unreadable outside a running deployment, so a manual script
 * can't hit the prod DB directly — this route is the way in). Probable
 * pitchers are only ever synced for the normal forward window regardless
 * of the override, since historical games don't have probable starters.
 */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const forwardStart = todayEt();
  const forwardEnd = shiftEtDate(forwardStart, 6);
  const startDate = url.searchParams.get("start") ?? forwardStart;
  const endDate = url.searchParams.get("end") ?? forwardEnd;

  try {
    const summary = await syncMlbSchedule(startDate, endDate);
    await recordPollLog(JOB_NAME, "ok");

    // Separate try/catch: a pitcher-sync hiccup shouldn't mark the
    // already-succeeded schedule sync as failed.
    let pitchersSummary = null;
    try {
      pitchersSummary = await syncProbablePitchers(forwardStart, forwardEnd);
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
