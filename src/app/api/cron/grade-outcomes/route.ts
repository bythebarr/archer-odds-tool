import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { gradeUngradedGames } from "@/lib/grading/gradeOutcomes";
import { classifyFetchStore, ingestHttpStatus, pollLogStatus, summaryForCaughtError } from "@/lib/engine/ingestResult";

const JOB_NAME = "grade-outcomes";

/**
 * Free (reads OddsSnapshot history + MLB Stats API scores already synced).
 *
 * `considered === 0` (nothing ungraded right now) is a legitimate empty run —
 * this fires every 15 minutes, so that's the common case. `considered > 0`
 * with `graded === 0` means final games sat there and NOT ONE produced a
 * GameOutcome row, which should not happen and must not read as "ok".
 */
export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  try {
    const { considered, graded } = await gradeUngradedGames();
    const { status, detail } = classifyFetchStore(
      { fetched: considered, stored: graded },
      { noun: "games" }
    );
    await recordPollLog(JOB_NAME, pollLogStatus({ status, detail }));
    return Response.json({ status, detail, considered, graded }, { status: ingestHttpStatus(status) });
  } catch (error) {
    const summary = summaryForCaughtError("mlb", error);
    await recordPollLog(JOB_NAME, pollLogStatus(summary));
    return Response.json(summary, { status: ingestHttpStatus(summary.status) });
  }
}
