import { prisma } from "@/lib/prisma";
import { checkAdminAuth } from "@/lib/adminAuth";
import { settlePendingUfcPlays } from "@/lib/discord/postResults";
import { gradeUfcMoneyline } from "@/lib/discord/gradePlay";
import { syncRecentUfcEvents } from "@/lib/ufc/backfillUfc";
import { formatAmerican } from "@/lib/odds/americanOdds";

// Run on every request — never statically cache an admin action.
export const dynamic = "force-dynamic";

/**
 * Admin: inspect + settle the UFC ledger. A UFC PostedPlay only enters the
 * #results record once its bout is `status: "completed"` with a winner synced
 * (see gradeUfcPlay in postResults.ts); until then it sits PENDING and is
 * invisible to the recap. When a fight card grades late — or backfill-ufc never
 * synced the result — the plays get stranded pending and the day looks like it
 * "never happened." This route makes that state visible and fixes it.
 *
 *   • GET  → table of every UFC posted play + its bout status/winner, so you can
 *            see at a glance which are graded, which are pending, and WHY a
 *            pending one hasn't settled (bout not completed vs. winner not synced
 *            vs. a corner→fighter mismatch that would grade wrong). No mutation.
 *   • POST → runs settlePendingUfcPlays() (same call the backfill-ufc cron makes)
 *            to settle every pending play whose bout is now final, then re-renders.
 *
 * Auth: same SSO gate as the other admin routes — this deployment sits behind
 * Vercel Deployment Protection, so only a logged-in team member can reach it.
 */

interface Row {
  postedForDate: string;
  selectionLabel: string;
  side: string;
  units: number;
  bestPrice: number;
  state: string;
  boutStatus: string;
  winner: string;
  wouldGrade: string;
}

async function buildRows(): Promise<Row[]> {
  const plays = await prisma.postedPlay.findMany({
    where: { sport: "ufc" },
    orderBy: [{ postedForDate: "desc" }, { createdAt: "asc" }],
  });
  if (plays.length === 0) return [];

  const boutIds = [...new Set(plays.map((p) => p.matchId))];
  const bouts = await prisma.ufcBout.findMany({
    where: { id: { in: boutIds } },
    select: {
      id: true,
      status: true,
      winnerFighterId: true,
      redCornerFighterId: true,
      blueCornerFighterId: true,
      winnerFighter: { select: { fullName: true } },
      method: true,
    },
  });
  const boutById = new Map(bouts.map((b) => [b.id, b]));

  return plays.map((p) => {
    const bout = boutById.get(p.matchId);
    const state = p.voided
      ? "voided"
      : p.gradedAt
        ? `graded: ${p.result}`
        : "PENDING";

    // For a still-pending play whose bout IS final, show what it *would* grade to
    // — this surfaces the corner-freeze / wrong-fighter bug (a completed bout that
    // would grade the pick against the wrong fighter id) without mutating anything.
    let wouldGrade = "—";
    if (!p.gradedAt && !p.voided && bout) {
      if (bout.status !== "completed") wouldGrade = "waiting on bout";
      else
        wouldGrade = gradeUfcMoneyline(
          p.side,
          bout.redCornerFighterId,
          bout.blueCornerFighterId,
          bout.winnerFighterId
        );
    }

    return {
      postedForDate: p.postedForDate,
      selectionLabel: p.selectionLabel,
      side: p.side,
      units: p.units,
      bestPrice: p.bestPrice,
      state,
      boutStatus: bout ? bout.status : "NO BOUT ROW",
      winner: bout?.winnerFighter?.fullName ?? (bout ? "—" : "?"),
      wouldGrade,
    };
  });
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

function tableHtml(rows: Row[]): string {
  if (rows.length === 0) {
    return `<p style="color:#888">No UFC plays have ever been recorded. If the 11th's card never posted a UFC embed, there's nothing to settle — the plays were never created (event outside the 3-day lookahead, stale odds, or no +EV side).</p>`;
  }
  const pending = rows.filter((r) => r.state === "PENDING").length;
  const head =
    `<p style="color:#444"><strong>${rows.length}</strong> UFC play${rows.length === 1 ? "" : "s"} on record · ` +
    `<strong style="color:${pending ? "#c0392b" : "#06996b"}">${pending}</strong> pending.</p>`;
  const cells = rows
    .map((r) => {
      const pendingBg = r.state === "PENDING" ? ' style="background:#fff5f5"' : "";
      return (
        `<tr${pendingBg}>` +
        `<td>${esc(r.postedForDate)}</td>` +
        `<td>${esc(r.selectionLabel)}</td>` +
        `<td>${esc(r.side)}</td>` +
        `<td style="text-align:right">${r.units}u</td>` +
        `<td style="text-align:right">${formatAmerican(r.bestPrice)}</td>` +
        `<td>${esc(r.state)}</td>` +
        `<td>${esc(r.boutStatus)}</td>` +
        `<td>${esc(r.winner)}</td>` +
        `<td>${esc(r.wouldGrade)}</td>` +
        `</tr>`
      );
    })
    .join("");
  return (
    head +
    `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:.85rem;margin-top:.5rem">` +
    `<thead><tr style="text-align:left;border-bottom:2px solid #ddd">` +
    `<th>Date</th><th>Pick</th><th>Side</th><th>Units</th><th>Price</th><th>State</th><th>Bout</th><th>Winner</th><th>Would grade</th>` +
    `</tr></thead><tbody>${cells.replace(/<td>/g, '<td style="padding:.35rem .6rem;border-bottom:1px solid #eee">')}</tbody></table></div>`
  );
}

function actionButton(mode: "sync" | "settle", label: string, bg: string): string {
  return (
    `<form method="POST" style="display:inline-block;margin:1.5rem .75rem 0 0">` +
    `<input type="hidden" name="mode" value="${mode}">` +
    `<button type="submit" style="font:600 1rem system-ui;background:${bg};color:#fff;border:0;border-radius:8px;padding:.7rem 1.4rem;cursor:pointer">${label}</button>` +
    `</form>`
  );
}

export async function GET(request: Request) {
  const denied = checkAdminAuth(request);
  if (denied) return denied;

  const rows = await buildRows();
  const controls = rows.some((r) => r.state === "PENDING")
    ? // Primary: sync fresh Cito results first, then settle — the one-click heal
      // for plays stuck "waiting on bout". Secondary: settle only (no Cito call)
      // when results are already synced and you just want to grade.
      actionButton("sync", "Sync results + settle", "#06996b") +
      actionButton("settle", "Settle only (no sync)", "#556") +
      `<p style="color:#888;font-size:.85rem;margin-top:.75rem"><strong>Sync results + settle</strong> pulls the latest completed cards from Cito (a few API credits) then grades — use this if anything reads "waiting on bout". <strong>Settle only</strong> skips the Cito call and just grades bouts already marked completed.</p>`
    : `<p style="color:#888;font-size:.85rem;margin-top:1rem">Nothing pending to settle.</p>`;
  return page("🥊 UFC ledger", tableHtml(rows), controls);
}

export async function POST(request: Request) {
  const denied = checkAdminAuth(request);
  if (denied) return denied;

  const form = await request.formData();
  const mode = form.get("mode") === "sync" ? "sync" : "settle";

  let syncBanner = "";
  if (mode === "sync") {
    try {
      const recent = await syncRecentUfcEvents();
      syncBanner = `<p style="color:#444">Synced ${recent.eventsProcessed} recent event${recent.eventsProcessed === 1 ? "" : "s"} (${recent.boutsProcessed} bout${recent.boutsProcessed === 1 ? "" : "s"}) from Cito.</p>`;
    } catch (err) {
      // Non-fatal: still try to settle whatever's already final.
      syncBanner = `<p style="color:#c0392b">Cito sync failed (settling from existing data): <code>${esc((err instanceof Error ? err.message : String(err)).slice(0, 200))}</code></p>`;
    }
  }

  const settled = await settlePendingUfcPlays();
  const rows = await buildRows();
  const banner =
    syncBanner +
    `<p style="color:#06996b;font-weight:600">Settled ${settled} play${settled === 1 ? "" : "s"}.` +
    (settled === 0
      ? ` Nothing moved — any remaining pending plays are still "waiting on bout" (their result hasn't synced yet). ${mode === "sync" ? "Cito may not have posted the result yet; try again later." : 'Try "Sync results + settle".'}`
      : ` They're now in the #results ledger.`) +
    `</p>`;
  return page("🥊 UFC ledger", banner + tableHtml(rows), "");
}

function page(title: string, body: string, extra: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title}</title>` +
      `<div style="font-family:system-ui,sans-serif;max-width:52rem;margin:8vh auto;padding:0 1.5rem;line-height:1.5">` +
      `<h1 style="font-size:1.4rem;margin:0 0 .5rem">${title}</h1>${body}${extra}</div>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}
