import { pollAndStoreOdds } from "@/lib/odds/ingest";
import { recordPollLog } from "@/lib/pollingPolicy";

// Run on every request — never statically cache an admin action.
export const dynamic = "force-dynamic";

/**
 * Admin: refresh MLB game-line odds RIGHT NOW, no Discord post.
 *
 * Unlike fire-card (which also posts the daily +EV card), this is the clean
 * "just unstick the odds" button. Two jobs:
 *
 *  1. Calls pollAndStoreOdds() directly, bypassing the low-credits guardrail in
 *     decidePollOdds — the guardrail reads the *last recorded* creditsRemaining
 *     from PollLog, so after the account runs down and the free tier is topped
 *     up (or the key swapped), the scheduled poll-odds cron keeps refusing
 *     itself on the stale number and never gets a chance to observe the fresh
 *     balance. This breaks that deadlock.
 *
 *  2. Records the fresh creditsRemaining into the `poll-odds` PollLog row, so
 *     the account-wide guardrail (getLatestCreditsRemaining) immediately sees
 *     real headroom again and the scheduled crons unstick themselves on their
 *     next tick. Without this write the odds would refresh but the guardrail
 *     would stay locked until something else happened to poll.
 *
 * Same platform posture as the other admin routes: reach it via the
 * -archr2.vercel.app deployment host, where Vercel SSO gates it to a logged-in
 * team member (the app proxy deliberately leaves /api ungated for the crons).
 */
export async function GET() {
  try {
    const s = await pollAndStoreOdds();
    await recordPollLog("poll-odds", "ok (admin refresh)", s.creditsUsed, s.creditsRemaining);

    const credits =
      s.creditsRemaining !== null ? ` — ${s.creditsRemaining} Odds API credits left` : "";
    const title = "✅ Odds refreshed";
    const body =
      `Priced <strong>${s.gamesMatched}</strong> game${s.gamesMatched === 1 ? "" : "s"}` +
      ` on current lines${credits}. The guardrail is unstuck — the scheduled polls ` +
      `will run normally from here. No Discord post was made.`;

    return htmlReceipt(title, body, 200);
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    // Best-effort: log the failure so /api/status reflects it, but don't throw.
    await recordPollLog("poll-odds", `error (admin refresh): ${message}`).catch(() => {});
    return htmlReceipt("❌ Odds refresh failed", `Error: <code>${message}</code>`, 502);
  }
}

function htmlReceipt(title: string, body: string, status: number): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title}</title>` +
      `<div style="font-family:system-ui,sans-serif;max-width:36rem;margin:14vh auto;padding:0 1.5rem;line-height:1.55">` +
      `<h1 style="font-size:1.4rem;margin:0 0 .5rem">${title}</h1>` +
      `<p style="color:#444">${body}</p></div>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}
