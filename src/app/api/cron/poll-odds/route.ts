import { checkCronAuth } from "@/lib/cronAuth";
import { decidePollOdds, recordPollLog } from "@/lib/pollingPolicy";
import { pollAndStoreOdds } from "@/lib/odds/ingest";

const JOB_NAME = "poll-odds";

/** GET: Vercel Cron (always invokes via GET). POST: manual/GH Actions dispatch. Same handler either way. */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const decision = await decidePollOdds(JOB_NAME);

  if (!decision.shouldPoll) {
    return Response.json({ polled: false, ...decision });
  }

  try {
    const summary = await pollAndStoreOdds();
    await recordPollLog(JOB_NAME, "ok", summary.creditsUsed, summary.creditsRemaining);
    return Response.json({ polled: true, ...decision, ...summary });
  } catch (error) {
    // Don't let a transient Odds API failure (rate limit, outage, bad key)
    // crash the cron tick — log it so the next tick can retry.
    const message = error instanceof Error ? error.message : String(error);
    await recordPollLog(JOB_NAME, `error: ${message}`);
    return Response.json({ polled: false, ...decision, error: message }, { status: 502 });
  }
}
