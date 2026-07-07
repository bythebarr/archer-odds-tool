import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { backfillUfcHistory, backfillUpcomingUfcEvents } from "@/lib/ufc/backfillUfc";

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
    // History first (completed events), then upcoming scheduled cards — both
    // idempotent, and once an upcoming event is fought the history sweep
    // re-upserts its bouts as completed with real results.
    const recent = await backfillUfcHistory();
    const upcoming = await backfillUpcomingUfcEvents();
    await recordPollLog(
      JOB_NAME,
      `ok (recent events: ${recent.eventsProcessed}, upcoming events: ${upcoming.eventsProcessed}, ` +
        `bouts: ${recent.boutsProcessed + upcoming.boutsProcessed}, ` +
        `skipped: ${recent.skippedBouts.length + upcoming.skippedBouts.length})`
    );
    return Response.json({ recent, upcoming });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordPollLog(JOB_NAME, `error: ${message}`);
    return Response.json({ error: message }, { status: 502 });
  }
}
