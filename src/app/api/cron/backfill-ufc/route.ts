import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { backfillUfcHistory } from "@/lib/ufc/backfillUfc";

const JOB_NAME = "backfill-ufc";

/** GET: Vercel Cron (always invokes via GET). POST: manual/GH Actions dispatch. Same handler either way. */
export async function GET(request: Request) {
  return POST(request);
}

/**
 * Runs the full historical UFC backfill (see backfillUfc.ts) — confirmed
 * locally that the entire ~806-event dataset completes in ~81 Cito API
 * calls, well under the 500/month free-tier quota, so no BATCH_LIMIT/resume
 * logic is needed here unlike backfill-player-game-logs.ts. Idempotent
 * throughout, so the daily schedule also keeps newly-completed events
 * synced going forward — this isn't purely a one-time catch-up job.
 */
export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  try {
    const summary = await backfillUfcHistory();
    await recordPollLog(
      JOB_NAME,
      `ok (events: ${summary.eventsProcessed}, bouts: ${summary.boutsProcessed}, skipped: ${summary.skippedBouts.length})`
    );
    return Response.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordPollLog(JOB_NAME, `error: ${message}`);
    return Response.json({ error: message }, { status: 502 });
  }
}
