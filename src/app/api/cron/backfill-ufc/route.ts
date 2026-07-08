import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { syncRecentUfcEvents, backfillUpcomingUfcEvents } from "@/lib/ufc/backfillUfc";

const JOB_NAME = "backfill-ufc";

/** GET: Vercel Cron (always invokes via GET). POST: manual/GH Actions dispatch. Same handler either way. */
export async function GET(request: Request) {
  return POST(request);
}

/**
 * Daily UFC sync (see backfillUfc.ts). Deliberately does NOT re-sweep the full
 * ~806-event history every day (that was ~81 Cito calls/day ≈ 2,400/month,
 * blowing the 500/month free tier). Instead syncRecentUfcEvents pages
 * newest-first and stops at the first already-settled event (~3-4 calls) to
 * keep the fighter-math model current, and backfillUpcomingUfcEvents pulls
 * scheduled cards (~1 call) — the upcoming ingest also self-heals through
 * sync-results if this cron misses (see sync-ufc-upcoming there). The initial
 * full catch-up is a separate manual backfillUfcHistory() run.
 */
export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  try {
    // Recent/completed events first, then upcoming scheduled cards — both
    // idempotent, and once an upcoming event is fought the recent sync
    // re-upserts its bouts as completed with real results.
    const recent = await syncRecentUfcEvents();
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
