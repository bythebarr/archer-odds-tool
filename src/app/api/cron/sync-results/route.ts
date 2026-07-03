import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { syncMlbSchedule } from "@/lib/mlb/syncSchedule";
import { syncProbablePitchers } from "@/lib/mlb/syncPitchers";

const JOB_NAME = "sync-results";
const PITCHERS_JOB_NAME = "sync-pitchers";

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

    return Response.json({ date, ...summary, pitchers: pitchersSummary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordPollLog(JOB_NAME, `error: ${message}`);
    return Response.json({ error: message }, { status: 502 });
  }
}
