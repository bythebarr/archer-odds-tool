import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { syncMlbSchedule } from "@/lib/mlb/syncSchedule";
import { todayEt, shiftEtDate } from "@/lib/dateEt";

const JOB_NAME = "sync-schedule";

/** Free (MLB Stats API), run once daily to extend the schedule window forward. */
export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startDate = todayEt();
  const endDate = shiftEtDate(startDate, 6);

  try {
    const summary = await syncMlbSchedule(startDate, endDate);
    await recordPollLog(JOB_NAME, "ok");
    return Response.json({ startDate, endDate, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordPollLog(JOB_NAME, `error: ${message}`);
    return Response.json({ error: message }, { status: 502 });
  }
}
