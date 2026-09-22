import { checkCronAuth } from "@/lib/cronAuth";
import { decideFixedCadencePoll, recordPollLog, writeOutcomeStatus } from "@/lib/pollingPolicy";
import { pollAndStoreNflOdds } from "@/lib/nfl/ingest";
import { classifyFetchStore, ingestHttpStatus, sanitizeErrorMessage } from "@/lib/engine/ingestResult";

const JOB_NAME = "poll-odds-nfl";
/**
 * Conservative fixed cadence (tennis/soccer's policy, not MLB's tiered
 * near-kickoff throttle) at 6 credits/call. It's July: per
 * docs/architecture/provider-coverage.md, NFL book depth can't be judged until
 * preseason, so this polls enough to prove the feed and not a credit more.
 * Revisit the interval — with a re-run of the coverage audit — in September.
 */
const MIN_INTERVAL_MINUTES = 6 * 60;

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
    const summary = await pollAndStoreNflOdds();
    // Events fetched but zero snapshots written is the failure this sport is most
    // exposed to: every price flows through an exact team-name match, and Parlay's
    // names are known to drift. Say so in the log rather than reporting a bare "ok".
    await recordPollLog(
      JOB_NAME,
      writeOutcomeStatus(summary.eventsFetched, summary.snapshotsWritten, "snapshots"),
      summary.creditsUsed,
      summary.creditsRemaining
    );
    const outcome = classifyFetchStore(
      { fetched: summary.eventsFetched, stored: summary.snapshotsWritten, rejected: summary.eventsSkippedNotNfl },
      { noun: "snapshots" }
    );
    return Response.json(
      { polled: true, status: outcome.status, ...decision, ...summary },
      { status: ingestHttpStatus(outcome.status) }
    );
  } catch (error) {
    // Same rationale as the other polls: a transient provider failure shouldn't
    // crash the cron tick — log it so the next scheduled run can retry.
    const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
    await recordPollLog(JOB_NAME, `error: ${message}`);
    return Response.json({ polled: false, status: "error", ...decision, error: message }, { status: 502 });
  }
}
