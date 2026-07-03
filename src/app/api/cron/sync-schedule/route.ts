import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { syncMlbSchedule } from "@/lib/mlb/syncSchedule";
import { syncProbablePitchers } from "@/lib/mlb/syncPitchers";
import { todayEt, shiftEtDate } from "@/lib/dateEt";

const JOB_NAME = "sync-schedule";
const PITCHERS_JOB_NAME = "sync-pitchers";

/** Free (MLB Stats API), run once daily to extend the schedule window forward. */
export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startDate = todayEt();
  const endDate = shiftEtDate(startDate, 6);

  try {
    const summary = await syncMlbSchedule(startDate, endDate);
    await recordPollLog(JOB_NAME, "ok");

    // Separate try/catch: a pitcher-sync hiccup shouldn't mark the
    // already-succeeded schedule sync as failed.
    let pitchersSummary = null;
    try {
      pitchersSummary = await syncProbablePitchers(startDate, endDate);
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
