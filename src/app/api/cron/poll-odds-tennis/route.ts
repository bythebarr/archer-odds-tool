import { checkCronAuth } from "@/lib/cronAuth";
import { decideFixedCadencePoll, recordPollLog } from "@/lib/pollingPolicy";
import { pollAndStoreTennisOdds } from "@/lib/tennis/ingest";
import { classifyFetchStore, ingestHttpStatus, pollLogStatus, summaryForCaughtError } from "@/lib/engine/ingestResult";

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
    // No allowlisted tournament active is a legitimate empty cycle, not a
    // failure. A resolved tournament that returns events but stores zero
    // matches is "unusable" — that used to log a bare "ok" here.
    const outcome =
      summary.sportKeyPolled === null
        ? { status: "empty" as const, detail: "no allowlisted tournament active this cycle" }
        : classifyFetchStore({ fetched: summary.eventsFetched, stored: summary.matchesStored }, { noun: "matches" });
    await recordPollLog(JOB_NAME, pollLogStatus(outcome), summary.creditsUsed, summary.creditsRemaining);
    return Response.json(
      { polled: true, status: outcome.status, detail: outcome.detail, ...decision, ...summary },
      { status: ingestHttpStatus(outcome.status) }
    );
  } catch (error) {
    // Same rationale as poll-odds: a transient Odds API failure shouldn't
    // crash the cron tick — log it so the next scheduled run can retry.
    const summary = summaryForCaughtError("tennis", error);
    await recordPollLog(JOB_NAME, pollLogStatus(summary));
    return Response.json({ polled: false, ...decision, ...summary }, { status: ingestHttpStatus(summary.status) });
  }
}
