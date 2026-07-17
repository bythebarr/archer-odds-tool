import { postMorningDrop } from "@/lib/discord/mosesDaily";
import { checkAdminAuth } from "@/lib/adminAuth";

// Run on every request — never statically cache an admin action.
export const dynamic = "force-dynamic";

/**
 * Admin diagnostic: fire the morning slate drop RIGHT NOW, on demand, so we can
 * see whether DISCORD_MOSES_WEBHOOK_URL is wired to a live channel — instead of
 * waiting for the 9am cron. Same SSO gate as the ledger reset: only a logged-in
 * Vercel team member can reach it. Temporary — delete once the webhook is
 * confirmed. GET so it runs from a plain browser click; returns an HTML receipt
 * that surfaces the real outcome (posted / dormant / Discord error).
 */
export async function GET(request: Request) {
  const denied = checkAdminAuth(request);
  if (denied) return denied;

  let outcome: string;
  let title: string;
  try {
    const result = await postMorningDrop();
    if (result.posted) {
      title = "✅ Morning drop fired";
      outcome =
        "It posted successfully. Check your Discord — whichever channel it landed in " +
        "is where <code>DISCORD_MOSES_WEBHOOK_URL</code> points. If that's the wrong " +
        "channel, edit the webhook to target #todays-lean.";
    } else {
      title = "⚠️ Nothing posted (dormant)";
      outcome =
        `The webhook is treated as unset — reason: <code>${result.reason ?? "unknown"}</code>. ` +
        "The <code>DISCORD_MOSES_WEBHOOK_URL</code> value is empty. Edit it in Vercel and paste a real webhook URL.";
    }
  } catch (err) {
    title = "❌ Discord rejected the post";
    outcome =
      "The webhook URL is set but Discord refused it (usually a deleted/typo'd webhook). " +
      `Error: <code>${(err instanceof Error ? err.message : String(err)).slice(0, 300)}</code>. ` +
      "Fix: create a fresh webhook on #todays-lean and overwrite the value in Vercel.";
  }

  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title}</title>` +
      `<div style="font-family:system-ui,sans-serif;max-width:36rem;margin:14vh auto;padding:0 1.5rem;line-height:1.55">` +
      `<h1 style="font-size:1.4rem;margin:0 0 .5rem">${title}</h1>` +
      `<p style="color:#444">${outcome}</p></div>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}
