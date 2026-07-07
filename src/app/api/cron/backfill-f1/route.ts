import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { backfillF1History } from "@/lib/f1/backfillF1";

const JOB_NAME = "backfill-f1";

/** GET: Vercel Cron (always invokes via GET). POST: manual/GH Actions dispatch. Same handler either way. */
export async function GET(request: Request) {
  return POST(request);
}

/**
 * Runs the F1 results backfill (see backfillF1.ts) against the free, no-auth
 * Jolpica API — no API key or credit budget is consumed, so this can run on a
 * normal daily schedule with no quota concern (unlike the paid Odds API
 * pollers). Idempotent, so the daily tick also syncs the current season's
 * newly-run races going forward, not just a one-time catch-up.
 *
 * Not yet wired into vercel.json — this stays dormant until F1 gets a UI, the
 * same staged rollout the UFC pipeline used. Kick it manually to seed data.
 */
export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  try {
    const summary = await backfillF1History();
    await recordPollLog(
      JOB_NAME,
      `ok (seasons: ${summary.seasonsProcessed}, races: ${summary.racesProcessed}, results: ${summary.resultsWritten})`
    );
    return Response.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordPollLog(JOB_NAME, `error: ${message}`);
    return Response.json({ error: message }, { status: 502 });
  }
}
