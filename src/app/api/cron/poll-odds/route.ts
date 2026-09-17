import { checkCronAuth } from "@/lib/cronAuth";
import { decidePollOdds, recordPollLog, writeOutcomeStatus } from "@/lib/pollingPolicy";
import { pollAndStoreOdds } from "@/lib/odds/ingest";
import { classifyFetchStore, ingestHttpStatus, sanitizeErrorMessage } from "@/lib/engine/ingestResult";

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
    // Events fetched but nothing stored means every event failed to match a
    // game. That match is an exact string comparison between ParlayAPI's team
    // names and our MLB-Stats-sourced ones — and Parlay's names are known to
    // drift ("Milwaukee Brewers @ New York", "Chicago Bulls" in an MLB feed),
    // so this is a live failure mode, not a theoretical one. `gamesUnmatched`
    // only ever appeared in the HTTP response body, which nobody reads.
    await recordPollLog(
      JOB_NAME,
      writeOutcomeStatus(summary.eventsFetched, summary.snapshotsWritten, "snapshots"),
      summary.creditsUsed,
      summary.creditsRemaining
    );
    // Same classification `writeOutcomeStatus` encodes as text, surfaced here
    // as a structured field so a caller doesn't have to parse the PollLog
    // string, and so the HTTP status reflects a genuine "unusable" outcome.
    const outcome = classifyFetchStore(
      { fetched: summary.eventsFetched, stored: summary.snapshotsWritten, rejected: summary.gamesUnmatched.length },
      { noun: "snapshots" }
    );
    return Response.json(
      { polled: true, status: outcome.status, ...decision, ...summary },
      { status: ingestHttpStatus(outcome.status) }
    );
  } catch (error) {
    // Don't let a transient Odds API failure (rate limit, outage, bad key)
    // crash the cron tick — log it so the next tick can retry.
    const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
    await recordPollLog(JOB_NAME, `error: ${message}`);
    return Response.json({ polled: false, status: "error", ...decision, error: message }, { status: 502 });
  }
}
