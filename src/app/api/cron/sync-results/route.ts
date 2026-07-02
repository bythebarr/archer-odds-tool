import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { syncMlbSchedule } from "@/lib/mlb/syncSchedule";

const JOB_NAME = "sync-results";

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
    return Response.json({ date, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordPollLog(JOB_NAME, `error: ${message}`);
    return Response.json({ error: message }, { status: 502 });
  }
}
