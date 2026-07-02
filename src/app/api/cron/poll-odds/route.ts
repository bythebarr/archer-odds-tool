import { checkCronAuth } from "@/lib/cronAuth";
import { decidePollOdds, recordPollLog } from "@/lib/pollingPolicy";
import { pollAndStoreOdds } from "@/lib/odds/ingest";

const JOB_NAME = "poll-odds";

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const decision = await decidePollOdds(JOB_NAME);

  if (!decision.shouldPoll) {
    return Response.json({ polled: false, ...decision });
  }

  const summary = await pollAndStoreOdds();
  await recordPollLog(JOB_NAME, "ok", summary.creditsUsed);

  return Response.json({ polled: true, ...decision, ...summary });
}
