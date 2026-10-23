import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { sanitizeErrorMessage } from "@/lib/engine/ingestResult";
import { runRetentionCleanup } from "@/lib/ops/cleanup";

const JOB_NAME = "cleanup";

/** Headroom over the cleanup's own 25s time budget. */
export const maxDuration = 60;

/** GET: Vercel Cron (always invokes via GET). POST: manual/GH Actions dispatch. Same handler either way. */
export async function GET(request: Request) {
  return POST(request);
}

/** Daily retention, in the 09:00 UTC window with the other housekeeping jobs. See lib/ops/cleanup.ts. */
export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  try {
    const summary = await runRetentionCleanup();
    const total = Object.values(summary.deleted).reduce((a, b) => a + b, 0);
    await recordPollLog(JOB_NAME, `ok (${total} rows pruned${summary.backlogRemaining ? ", backlog continues tomorrow" : ""})`);
    return Response.json({ ok: true, ...summary });
  } catch (error) {
    const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
    await recordPollLog(JOB_NAME, `error: ${message}`);
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
