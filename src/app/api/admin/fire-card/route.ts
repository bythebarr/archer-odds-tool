import { pollAndStoreOdds } from "@/lib/odds/ingest";
import { postDailyCardToDiscord } from "@/lib/discord/postCard";
import { checkAdminAuth } from "@/lib/adminAuth";

// Run on every request — never statically cache an admin action.
export const dynamic = "force-dynamic";

/**
 * Admin: refresh MLB odds and post today's +EV card RIGHT NOW. For the day the
 * 10:30am cron gets skipped (e.g. a schedule change landing after 10:30, or a
 * one-off miss) — the crons handle every normal day, this is the manual kick.
 * Refreshes odds first (today's midday poll may have been skipped the same way),
 * then posts, so the card prices off current lines rather than last night's.
 *
 * Same SSO gate as the other admin routes: only a logged-in Vercel team member
 * can reach it. Temporary-ish, but harmless to keep — it just re-posts the card.
 * GET so it runs from a browser click; returns an HTML receipt.
 */
export async function GET(request: Request) {
  const denied = checkAdminAuth(request);
  if (denied) return denied;

  let oddsLine: string;
  try {
    const s = await pollAndStoreOdds();
    oddsLine = `Odds refreshed — ${s.gamesMatched} games priced${
      s.creditsRemaining !== null ? ` (${s.creditsRemaining} Odds API credits left)` : ""
    }.`;
  } catch (err) {
    // Non-fatal: still post from whatever odds we already hold.
    oddsLine = `Odds refresh failed (posting from existing lines): ${
      (err instanceof Error ? err.message : String(err)).slice(0, 160)
    }`;
  }

  let title: string;
  let cardLine: string;
  try {
    const r = await postDailyCardToDiscord();
    if (r.posted) {
      title = "✅ Card posted";
      cardLine =
        `Dropped <strong>${r.premiumCount ?? 0}</strong> +EV play${r.premiumCount === 1 ? "" : "s"} to the premium channel` +
        `${r.ufcCount ? ` + ${r.ufcCount} UFC lean${r.ufcCount === 1 ? "" : "s"}` : ""}` +
        `. Go check Discord.`;
    } else {
      title = "⚠️ Card didn't post";
      cardLine = `Reason: <code>${r.reason ?? "unknown"}</code>.`;
    }
  } catch (err) {
    title = "❌ Card post failed";
    cardLine = `Error: <code>${(err instanceof Error ? err.message : String(err)).slice(0, 300)}</code>`;
  }

  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title}</title>` +
      `<div style="font-family:system-ui,sans-serif;max-width:36rem;margin:14vh auto;padding:0 1.5rem;line-height:1.55">` +
      `<h1 style="font-size:1.4rem;margin:0 0 .5rem">${title}</h1>` +
      `<p style="color:#444">${cardLine}</p>` +
      `<p style="color:#888;font-size:.9rem;margin-top:1rem">${oddsLine}</p></div>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}
