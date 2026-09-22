import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog, writeOutcomeStatus } from "@/lib/pollingPolicy";
import { syncAndGradeTennisResults } from "@/lib/tennis/results";
import { classifyFetchStore, ingestHttpStatus, sanitizeErrorMessage } from "@/lib/engine/ingestResult";

const JOB_NAME = "sync-results-tennis";

/** GET: Vercel Cron (always invokes via GET). POST: manual/GH Actions dispatch. Same handler either way. */
export async function GET(request: Request) {
  return POST(request);
}

/**
 * No credit guardrail here, unlike the odds polls: ESPN's scoreboard is free and
 * unkeyed, so this is rate-limited only by its cron schedule. That's also why it
 * re-checks several days rather than just today — see LOOKBACK_DAYS.
 */
export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  try {
    const summary = await syncAndGradeTennisResults();
    // Judged against OUR overdue matches, not ESPN's result count: tennis is
    // priced only when a tournament we carry is live, so "no tennis today" has
    // to read as nothing-to-do, while "matches sat unsettled and none graded"
    // has to read as an error. That second case is precisely the silence that
    // let tennis look healthy for weeks while settling nothing.
    // max(), because a match that finished inside the settle grace grades on this
    // very run without ever having been counted overdue — reporting that as
    // "nothing to do" would undersell a run that did real work.
    const considered = Math.max(summary.awaitingResults, summary.matchesGraded);
    await recordPollLog(JOB_NAME, writeOutcomeStatus(considered, summary.matchesGraded, "matches graded"));
    const outcome = classifyFetchStore(
      { fetched: considered, stored: summary.matchesGraded },
      { noun: "matches graded" }
    );
    return Response.json(
      { ok: outcome.status === "ok" || outcome.status === "empty", status: outcome.status, ...summary },
      { status: ingestHttpStatus(outcome.status) }
    );
  } catch (error) {
    const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
    await recordPollLog(JOB_NAME, `error: ${message}`);
    return Response.json({ ok: false, status: "error", error: message }, { status: 502 });
  }
}
