import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { backfillMissingPlayerGameLogs } from "@/lib/props/syncGameLogs";

const JOB_NAME = "backfill-player-game-logs";

/**
 * Bounded per invocation (not all ~1,600 games at once) to stay well under
 * the serverless function timeout — ~150 games x (a boxscore fetch + a
 * short delay) comfortably fits in well under 300s. Call this route
 * repeatedly (e.g. via `vercel crons run`) until the response's `remaining`
 * count hits 0; the daily cron schedule then keeps it a no-op safety net
 * once fully caught up (see backfillMissingPlayerGameLogs's early-return).
 */
const BATCH_LIMIT = 150;

/** GET: Vercel Cron (always invokes via GET). POST: manual/GH Actions dispatch. Same handler either way. */
export async function GET(request: Request) {
  return POST(request);
}

/** Free (MLB Stats API) — no query params by design, so a plain `vercel crons run` trigger (no way to pass params) is all that's needed. */
export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  try {
    const summary = await backfillMissingPlayerGameLogs(BATCH_LIMIT);
    // Remaining count surfaced in lastStatus (visible via /api/status) since
    // this cron's response body otherwise isn't observable from outside a
    // running deployment during the multi-call historical catch-up.
    await recordPollLog(JOB_NAME, `ok (remaining: ${summary.remaining})`);
    return Response.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordPollLog(JOB_NAME, `error: ${message}`);
    return Response.json({ error: message }, { status: 502 });
  }
}
