import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { syncRecentUfcEvents, backfillUpcomingUfcEvents, advanceUfcPhotoSeed } from "@/lib/ufc/backfillUfc";

const JOB_NAME = "backfill-ufc";

/** GET: Vercel Cron (always invokes via GET). POST: manual/GH Actions dispatch. Same handler either way. */
export async function GET(request: Request) {
  return POST(request);
}

// The historical photo seed can page a lot on early runs; give the function
// headroom over the default so a chunk finishes in one invocation.
export const maxDuration = 300;

/**
 * Daily UFC sync (see backfillUfc.ts). Deliberately does NOT re-sweep the full
 * ~806-event history every day (that was ~81 Cito calls/day ≈ 2,400/month,
 * blowing the 500/month free tier). Instead syncRecentUfcEvents pages
 * newest-first and stops at the first already-settled event (~3-4 calls) and
 * backfillUpcomingUfcEvents pulls scheduled cards (~1 call). advanceUfcPhotoSeed
 * then walks the deep history a chunk at a time to backfill fighter photos
 * (a one-time job that finishes in a few days, then no-ops). The initial full
 * catch-up is a separate manual backfillUfcHistory() run.
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

    // Historical photo seed runs after the fresh-data work and is isolated:
    // if it 429s partway (Cito rate limit), the cursor doesn't advance and it
    // retries next run — but it must NOT fail the whole job, since recent +
    // upcoming already succeeded above.
    let seed: string;
    try {
      seed = await advanceUfcPhotoSeed();
    } catch (seedError) {
      seed = `error: ${seedError instanceof Error ? seedError.message : String(seedError)}`;
    }

    await recordPollLog(
      JOB_NAME,
      `ok (recent events: ${recent.eventsProcessed}, upcoming events: ${upcoming.eventsProcessed}, ` +
        `bouts: ${recent.boutsProcessed + upcoming.boutsProcessed}, ` +
        `skipped: ${recent.skippedBouts.length + upcoming.skippedBouts.length}, photo-seed: ${seed})`
    );
    return Response.json({ recent, upcoming, seed });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordPollLog(JOB_NAME, `error: ${message}`);
    return Response.json({ error: message }, { status: 502 });
  }
}
