import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { backfillF1History } from "@/lib/f1/backfillF1";
import { ingestHttpStatus, pollLogStatus, summaryForCaughtError, type IngestStatus } from "@/lib/engine/ingestResult";

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
 * Wired into vercel.json as a daily backstop (50 9 UTC). Steady-state F1
 * freshness is really carried by the read-side self-heal (refreshF1OnView on
 * the /f1 page); this cron is belt-and-suspenders for days the page isn't
 * viewed. Zero-credit (free Jolpica) and idempotent, so a daily tick is free.
 */
export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  try {
    const summary = await backfillF1History();
    // NOTE: `resultsWritten` is not a reliable "did this work" signal on its
    // own — the write path is idempotent (skipDuplicates), so a healthy daily
    // re-run over already-backfilled seasons routinely writes 0 new rows.
    // That means this route (unlike the odds/schedule polls) can't currently
    // tell "wrote nothing because everything was already there" from "wrote
    // nothing because something's wrong" — see the Step 2 remediation note in
    // docs/architecture/EDGE-BASELINE-AUDIT.md. Classifying on `racesProcessed`
    // (did Jolpica give us anything at all for the window) is the honest
    // signal available without changing the write path's counting.
    const status: IngestStatus = summary.racesProcessed === 0 ? "empty" : "ok";
    const detail =
      status === "empty"
        ? "no races with results in the backfill window"
        : `processed ${summary.racesProcessed} races across ${summary.seasonsProcessed} seasons, ${summary.resultsWritten} new result rows`;
    await recordPollLog(JOB_NAME, pollLogStatus({ status, detail }));
    return Response.json({ status, detail, ...summary }, { status: ingestHttpStatus(status) });
  } catch (error) {
    const summary = summaryForCaughtError("f1", error);
    await recordPollLog(JOB_NAME, pollLogStatus(summary));
    return Response.json(summary, { status: ingestHttpStatus(summary.status) });
  }
}
