import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog, writeOutcomeStatus } from "@/lib/pollingPolicy";
import { syncAndGradeNflResults } from "@/lib/nfl/results";

const JOB_NAME = "sync-results-nfl";

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
    const summary = await syncAndGradeNflResults();
    // Completed results fetched but nothing graded means every one failed to
    // match a Game row — the exact silent failure mode that let tennis "succeed"
    // for weeks while grading nothing.
    await recordPollLog(JOB_NAME, writeOutcomeStatus(summary.resultsFetched, summary.gamesGraded, "games graded"));
    return Response.json({ ok: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordPollLog(JOB_NAME, `error: ${message}`);
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
