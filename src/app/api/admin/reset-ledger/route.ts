import { prisma } from "@/lib/prisma";
import { checkAdminAuth } from "@/lib/adminAuth";
import { todayEt } from "@/lib/dateEt";

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
 *
 * The default keeps TODAY. On 2026-07-20 a blanket wipe ran mid-slate and took
 * that night's ungraded plays with it — the card had already posted, the games
 * hadn't finished, and the rows were gone before the grader ever saw them, so
 * the night could never be recapped. Nothing about the click said that would
 * happen. So the plain button now clears history *before* today and leaves the
 * night in flight alone; erasing everything is a separate, explicitly-labelled
 * button (`?all=1`), not the thing you get by default.
 */
export async function GET(request: Request) {
  const denied = checkAdminAuth(request);
  if (denied) return denied;

  const today = todayEt();
  return page(
    "⚠️ Reset the results ledger?",
    `Clears the recorded history <strong>before ${today}</strong> — all-time record and streaks ` +
      `restart. Today's card is <strong>kept</strong>, so a slate already in play still grades ` +
      `and still posts its recap. This can't be undone.`,
    `<form method="POST" style="margin-top:1.5rem">
       <button type="submit" style="font:600 1rem system-ui;background:#c0392b;color:#fff;border:0;border-radius:8px;padding:.7rem 1.4rem;cursor:pointer">
         Wipe history before today
       </button>
     </form>
     <form method="POST" action="?all=1" style="margin-top:2.5rem">
       <p style="color:#777;font-size:.85rem;margin:0 0 .5rem">
         Or erase <strong>everything</strong>, including today's card — plays that haven't
         graded yet are lost and that day can never be recapped.
       </p>
       <button type="submit" style="font:600 .85rem system-ui;background:none;color:#c0392b;border:1px solid #c0392b;border-radius:8px;padding:.5rem 1rem;cursor:pointer">
         Erase everything
       </button>
     </form>`
  );
}

export async function POST(request: Request) {
  const denied = checkAdminAuth(request);
  if (denied) return denied;

  // `?before=YYYY-MM-DD` clears only the history BEFORE that card date, which is
  // what "start the record clean" almost always means: the old results go, and
  // the night already in flight still counts. That boundary is now the DEFAULT
  // (today's date) rather than something the caller has to remember, because
  // forgetting it destroys ungraded plays irreversibly — see the note above GET.
  //
  // Erasing everything stays possible, but only when asked for by name: `?all=1`.
  // An empty `before=` (a blank workflow input) reads as "not supplied", so a
  // fumbled parameter lands on the safe default instead of the destructive one.
  // postedForDate is an ET date string, so a string comparison is the right one.
  const params = new URL(request.url).searchParams;
  const wipeAll = params.get("all") === "1";
  const before = params.get("before")?.trim() || todayEt();

  const { count } = wipeAll
    ? await prisma.postedPlay.deleteMany()
    : await prisma.postedPlay.deleteMany({ where: { postedForDate: { lt: before } } });

  return page(
    "✅ Ledger wiped",
    `Cleared <strong>${count}</strong> recorded play${count === 1 ? "" : "s"}` +
      (wipeAll
        ? `. The #results record now starts clean — the next card rebuilds it from scratch.`
        : ` from before <strong>${before}</strong>. Cards from ${before} onward are untouched and still grade normally.`),
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
