import { checkCronAuth } from "@/lib/cronAuth";
import { decideFixedCadencePoll, recordPollLog } from "@/lib/pollingPolicy";
import { pollAndStoreTennisOdds } from "@/lib/tennis/ingest";

const JOB_NAME = "poll-odds-tennis";
/** Anti-duplicate guard, not the primary cadence — Vercel Cron's own schedule (1x/day) controls that. See the tennis plan doc's credit budget. */
const MIN_INTERVAL_MINUTES = 12 * 60;

/** GET: Vercel Cron (always invokes via GET). POST: manual/GH Actions dispatch. Same handler either way. */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const decision = await decideFixedCadencePoll(JOB_NAME, MIN_INTERVAL_MINUTES);

  if (!decision.shouldPoll) {
    return Response.json({ polled: false, ...decision });
  }

  try {
    const summary = await pollAndStoreTennisOdds();
    await recordPollLog(JOB_NAME, "ok", summary.creditsUsed, summary.creditsRemaining);
    return Response.json({ polled: true, ...decision, ...summary });
  } catch (error) {
    // Same rationale as poll-odds: a transient Odds API failure shouldn't
    // crash the cron tick — log it so the next scheduled run can retry.
    const message = error instanceof Error ? error.message : String(error);
    await recordPollLog(JOB_NAME, `error: ${message}`);
    return Response.json({ polled: false, ...decision, error: message }, { status: 502 });
  }
}
