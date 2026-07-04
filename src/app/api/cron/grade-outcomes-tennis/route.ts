import { checkCronAuth } from "@/lib/cronAuth";
import { decideFixedCadencePoll, recordPollLog } from "@/lib/pollingPolicy";
import { syncAndGradeTennisResults } from "@/lib/tennis/grading";

const JOB_NAME = "grade-outcomes-tennis";
/** Every 2 days, not daily — /scores costs 2 credits/call (measured, not the 1 credit docs suggested); see the tennis plan doc's credit budget. */
const MIN_INTERVAL_MINUTES = 2 * 24 * 60;

/** GET: Vercel Cron (always invokes via GET). POST: manual/GH Actions dispatch. Same handler either way. */
export async function GET(request: Request) {
  return POST(request);
}

/** Unlike MLB's grade-outcomes (free — MLB Stats API), this costs credits (fetchScores), so it needs the same guardrail poll-odds-tennis does. */
export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const decision = await decideFixedCadencePoll(JOB_NAME, MIN_INTERVAL_MINUTES);

  if (!decision.shouldPoll) {
    return Response.json({ graded: false, ...decision });
  }

  try {
    const summary = await syncAndGradeTennisResults();
    await recordPollLog(JOB_NAME, "ok", summary.creditsUsed, summary.creditsRemaining);
    return Response.json({ graded: true, ...decision, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordPollLog(JOB_NAME, `error: ${message}`);
    return Response.json({ graded: false, ...decision, error: message }, { status: 502 });
  }
}
