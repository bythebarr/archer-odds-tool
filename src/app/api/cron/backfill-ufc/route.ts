import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { syncRecentUfcEvents, backfillUpcomingUfcEvents } from "@/lib/ufc/backfillUfc";
import { settlePendingUfcPlays } from "@/lib/discord/postResults";
import { classifyUfcIngest, ingestHttpStatus, pollLogStatus, summaryForCaughtError } from "@/lib/engine/ingestResult";

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
    // Now that results are freshly synced, settle any posted UFC plays whose
    // bout just went final — so #results reflects fight night without waiting
    // on the morning recap's single-date pass. Best-effort: a grading hiccup
    // must not fail the sync itself.
    let ufcPlaysSettled = 0;
    try {
      ufcPlaysSettled = await settlePendingUfcPlays();
    } catch (err) {
      console.error("settlePendingUfcPlays failed (sync still succeeded):", err);
    }

    // Zero new/updated events is the normal case most ticks (syncRecentUfcEvents
    // stops at the first already-settled event) — not a failure. events vs.
    // bouts is NOT a same-unit fetched/stored pair (an event's bout count
    // increments before its bouts are even looked at), so this uses the
    // UFC-specific classifier rather than the generic fetched/stored one —
    // see classifyUfcIngest's doc for why.
    const eventsProcessed = recent.eventsProcessed + upcoming.eventsProcessed;
    const boutsProcessed = recent.boutsProcessed + upcoming.boutsProcessed;
    const rejected = recent.skippedBouts.length + upcoming.skippedBouts.length;
    const outcome = classifyUfcIngest({ eventsProcessed, boutsProcessed, rejected });
    await recordPollLog(
      JOB_NAME,
      pollLogStatus({
        status: outcome.status,
        detail: `${outcome.detail}, ufc plays settled: ${ufcPlaysSettled}`,
      })
    );
    return Response.json(
      { status: outcome.status, detail: outcome.detail, recent, upcoming, ufcPlaysSettled },
      { status: ingestHttpStatus(outcome.status) }
    );
  } catch (error) {
    const summary = summaryForCaughtError("ufc", error);
    await recordPollLog(JOB_NAME, pollLogStatus(summary));
    return Response.json(summary, { status: ingestHttpStatus(summary.status) });
  }
}
