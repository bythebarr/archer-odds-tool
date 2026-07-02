import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { syncMlbSchedule } from "@/lib/mlb/syncSchedule";

const JOB_NAME = "sync-schedule";

function todayPlus(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Free (MLB Stats API), run once daily to extend the schedule window forward. */
export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startDate = todayPlus(0);
  const endDate = todayPlus(6);

  const summary = await syncMlbSchedule(startDate, endDate);
  await recordPollLog(JOB_NAME, "ok");

  return Response.json({ startDate, endDate, ...summary });
}
