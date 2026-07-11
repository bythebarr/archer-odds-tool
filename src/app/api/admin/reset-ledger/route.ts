import { prisma } from "@/lib/prisma";

/**
 * Admin: wipe the #results ledger — every recorded PostedPlay (day cards + all-
 * time record + streaks). One-shot reset for when the record needs to start
 * clean (the switch from the old capped card to posting every +EV play, and
 * again at real launch). The poster re-records the next card into the empty
 * table, so the running record simply restarts from the next 10:30 drop.
 *
 * Auth: this deployment sits behind Vercel Deployment Protection (SSO), so the
 * only people who can reach this route in a browser are logged-in team members
 * (i.e. you). That's the gate. The extra `?confirm=wipe-ledger` is a deliberate,
 * un-prefetchable opt-in so a stray click / crawler can't fire it. If Deployment
 * Protection is ever turned off, delete this route — the SSO wall IS the lock.
 *
 * GET so it runs from a plain browser click; returns a friendly HTML receipt.
 */
export async function GET(request: Request) {
  const confirm = new URL(request.url).searchParams.get("confirm");
  if (confirm !== "wipe-ledger") {
    return html(
      400,
      "Reset not confirmed",
      "Add <code>?confirm=wipe-ledger</code> to the URL to run the wipe. Nothing was changed."
    );
  }

  const { count } = await prisma.postedPlay.deleteMany({});
  return html(
    200,
    "✅ Ledger wiped",
    `Cleared <strong>${count}</strong> recorded play${count === 1 ? "" : "s"}. ` +
      "The #results record now starts clean — the next 10:30 AM card rebuilds it from scratch."
  );
}

function html(status: number, title: string, body: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title}</title>` +
      `<div style="font-family:system-ui,sans-serif;max-width:34rem;margin:16vh auto;padding:0 1.5rem;line-height:1.5">` +
      `<h1 style="font-size:1.4rem;margin:0 0 .5rem">${title}</h1>` +
      `<p style="color:#444">${body}</p></div>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}
