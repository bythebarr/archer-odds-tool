import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { gradeUngradedGames } from "@/lib/grading/gradeOutcomes";

const JOB_NAME = "grade-outcomes";

/** Free (reads OddsSnapshot history + MLB Stats API scores already synced). */
export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  try {
    const gradedGames = await gradeUngradedGames();
    await recordPollLog(JOB_NAME, "ok");
    return Response.json({ gradedGames });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordPollLog(JOB_NAME, `error: ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }
}
