import { prisma } from "@/lib/prisma";

// Run on every request — never statically cache an admin action.
export const dynamic = "force-dynamic";

/**
 * Admin: wipe the #results ledger — every recorded PostedPlay (day cards + all-
 * time record + streaks). One-shot reset for when the record needs to start
 * clean (the switch from the old capped card to posting every +EV play, and
 * again at real launch). The poster re-records the next card into the empty
 * table, so the running record simply restarts from the next 10:30 drop.
 *
 * Auth: this deployment sits behind Vercel Deployment Protection (SSO), so the
 * only people who can reach this route in a browser are logged-in team members
 * (i.e. you). If Deployment Protection is ever turned off, delete this route.
 *
 * Two-step by design so a stray click / crawler can't wipe anything:
 *   • GET  → shows a confirmation page with a button (no query params to fumble)
 *   • POST → the button submits this; it does the actual delete + shows a receipt
 */
export async function GET() {
  return page(
    "⚠️ Reset the results ledger?",
    `This clears <strong>every</strong> recorded play — yesterday, all-time, streaks. ` +
      `It can't be undone. The record restarts from the next 10:30&nbsp;AM card.`,
    `<form method="POST" style="margin-top:1.5rem">
       <button type="submit" style="font:600 1rem system-ui;background:#c0392b;color:#fff;border:0;border-radius:8px;padding:.7rem 1.4rem;cursor:pointer">
         Wipe the ledger
       </button>
     </form>`
  );
}

export async function POST() {
  const { count } = await prisma.postedPlay.deleteMany({});
  return page(
    "✅ Ledger wiped",
    `Cleared <strong>${count}</strong> recorded play${count === 1 ? "" : "s"}. ` +
      `The #results record now starts clean — the next 10:30&nbsp;AM card rebuilds it from scratch.`,
    ""
  );
}

function page(title: string, body: string, extra: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title}</title>` +
      `<div style="font-family:system-ui,sans-serif;max-width:34rem;margin:14vh auto;padding:0 1.5rem;line-height:1.55">` +
      `<h1 style="font-size:1.4rem;margin:0 0 .5rem">${title}</h1>` +
      `<p style="color:#444">${body}</p>${extra}</div>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}
