import { checkCronAuth } from "@/lib/cronAuth";
import { postResultsRecap } from "@/lib/discord/postResults";

/**
 * Grades yesterday's posted plays and posts the #results recap. Dormant until
 * DISCORD_RESULTS_WEBHOOK_URL is set (postResultsRecap returns
 * `{ posted: false }` and this is a no-op), so it's safe on the schedule before
 * the Discord exists. Runs late-morning ET, after overnight result syncs.
 */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  try {
    const result = await postResultsRecap();
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ posted: false, error: message }, { status: 502 });
  }
}
