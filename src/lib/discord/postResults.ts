import { prisma } from "@/lib/prisma";
import { todayEt } from "@/lib/dateEt";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { STAT_COLUMN } from "@/lib/props/hitRate";
import { gradeGameLine, gradeProp, gradeUfcMoneyline, tallyLedger, type PlayResult } from "./gradePlay";
import type { PostedPlay } from "@/generated/prisma/client";

/**
 * The #results engine. Grades the plays the poster recorded (see postCard.ts)
 * against final results and posts a transparent recap — yesterday's card W-L-P
 * + unit P/L, every result shown (wins AND losses), plus the running all-time
 * ledger. This is the trust spine of a paid room; it never hides a loss.
 *
 * Correctness posture (matches the grader): MLB (game lines vs final score,
 * props vs the actual stat line) and UFC (moneyline vs the bout winner) are
 * graded; other sports and true no-action are voided out of the record. A play
 * whose event isn't final yet — an MLB game mid-play, a UFC bout not yet fought,
 * a prop whose game log hasn't synced — is left PENDING (not voided) so a later
 * pass settles it; we never turn a sync lag into a fake loss or a premature void.
 * UFC plays also settle out-of-band via settlePendingUfcPlays (called from the
 * UFC sync cron), since fight cards finish late and may miss the morning recap.
 *
 * Dormant until DISCORD_RESULTS_WEBHOOK_URL is set.
 */

const ARCHR_GREEN = 0x06996b;
const RESEARCH_FOOTER =
  "Research/entertainment only · not betting advice · 21+ · gamble responsibly 1-800-522-4700";

const SPORT_LABEL: Record<string, string> = { mlb: "MLB", tennis: "TEN", soccer: "SOC", ufc: "UFC" };
const KIND_LABEL: Record<string, string> = { ml: "ML", spread: "SPR", total: "TOT", prop: "PROP" };
const RESULT_ICON: Record<Exclude<PlayResult, "void">, string> = { hit: "✅", miss: "❌", push: "➖" };

export interface ResultsPostResult {
  posted: boolean;
  reason?: string;
  dayRecord?: string;
  dayUnits?: number;
  graded?: number;
}

/** Yesterday's ET date (games settle overnight; the recap runs the next morning). */
function yesterdayEt(): string {
  const d = new Date(`${todayEt()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function prettyDate(dateEt: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, m, d] = dateEt.split("-").map(Number);
  return `${months[m - 1]} ${d}`;
}

function fmtUnits(u: number): string {
  const s = u.toFixed(2).replace(/\.?0+$/, "");
  return u >= 0 ? `+${s}u` : `${s}u`;
}

async function settlePlay(id: string, result: PlayResult): Promise<void> {
  await prisma.postedPlay.update({
    where: { id },
    data: {
      gradedAt: new Date(),
      voided: result === "void",
      result: result === "void" ? null : result,
    },
  });
}

/** Settle one UFC moneyline play against its bout, or null if the fight isn't final yet (leave pending). */
async function gradeUfcPlay(play: PostedPlay): Promise<PlayResult | null> {
  const bout = await prisma.ufcBout.findUnique({
    where: { id: play.matchId },
    select: { status: true, winnerFighterId: true, redCornerFighterId: true, blueCornerFighterId: true },
  });
  if (!bout) return "void";
  if (bout.status !== "completed") return null; // not fought yet — leave pending for a later pass
  return gradeUfcMoneyline(play.side, bout.redCornerFighterId, bout.blueCornerFighterId, bout.winnerFighterId);
}

/**
 * Settle every still-pending UFC play whose bout is now final — called from the
 * UFC sync cron (backfill-ufc) so late fight-night results grade promptly,
 * independent of the morning recap's single-date pass. Returns the count newly
 * settled. The all-time ledger stays correct regardless of which pass grades a play.
 */
export async function settlePendingUfcPlays(): Promise<number> {
  const pending = await prisma.postedPlay.findMany({ where: { sport: "ufc", gradedAt: null } });
  let settled = 0;
  for (const play of pending) {
    const result = await gradeUfcPlay(play);
    if (result === null) continue;
    await settlePlay(play.id, result);
    settled++;
  }
  return settled;
}

/** Settle every still-pending play for a date against final results. */
async function gradePending(dateEt: string): Promise<number> {
  const pending = await prisma.postedPlay.findMany({
    where: { postedForDate: dateEt, gradedAt: null },
  });

  let graded = 0;
  for (const play of pending) {
    // UFC: settle against the bout winner (stays pending until the fight is final).
    if (play.sport === "ufc") {
      const result = await gradeUfcPlay(play);
      if (result === null) continue; // not fought yet — leave pending
      await settlePlay(play.id, result);
      graded++;
      continue;
    }
    // MLB is the only other gradeable sport; everything else is no-action.
    if (play.sport !== "mlb") {
      await settlePlay(play.id, "void");
      graded++;
      continue;
    }

    const game = await prisma.game.findUnique({ where: { id: play.matchId } });
    if (!game || game.status !== "final" || game.homeScore === null || game.awayScore === null) {
      continue; // not final yet — leave pending for a later pass
    }

    if (play.kind === "prop") {
      if (!play.mlbPlayerId || !play.statCategory || play.point === null) {
        await settlePlay(play.id, "void");
        graded++;
        continue;
      }
      const log = await prisma.playerGameLog.findUnique({
        where: { mlbPlayerId_gameId: { mlbPlayerId: play.mlbPlayerId, gameId: game.id } },
      });
      if (!log) continue; // log not synced yet (or DNP) — stay pending, never a fake loss
      const value = (log as unknown as Record<string, number | null>)[STAT_COLUMN[play.statCategory]] ?? null;
      await settlePlay(play.id, gradeProp(play.side, play.point, value));
      graded++;
      continue;
    }

    if (play.market) {
      await settlePlay(
        play.id,
        gradeGameLine(
          play.market as "h2h" | "spreads" | "totals",
          play.side,
          play.point,
          game.homeScore,
          game.awayScore
        )
      );
    } else {
      await settlePlay(play.id, "void");
    }
    graded++;
  }
  return graded;
}

function ledgerInput(p: PostedPlay): { result: PlayResult; units: number; bestPrice: number } {
  const result: PlayResult = p.voided ? "void" : (p.result as PlayResult | null) ?? "void";
  return { result, units: p.units, bestPrice: p.bestPrice };
}

function resultLine(p: PostedPlay): string {
  const result: Exclude<PlayResult, "void"> = (p.result as Exclude<PlayResult, "void">) ?? "push";
  const tag = `${SPORT_LABEL[p.sport] ?? p.sport.toUpperCase()} ${KIND_LABEL[p.kind] ?? ""}`.trim();
  const pl = p.result ? ` → ${fmtUnits(settledProfit(p))}` : "";
  return `${RESULT_ICON[result]} \`${tag}\` ${p.selectionLabel} ${formatAmerican(p.bestPrice)} · ${p.units}u${pl}`;
}

function settledProfit(p: PostedPlay): number {
  return tallyLedger([ledgerInput(p)]).netUnits;
}

export async function postResultsRecap(dateEt: string = yesterdayEt()): Promise<ResultsPostResult> {
  const url = process.env.DISCORD_RESULTS_WEBHOOK_URL;
  if (!url) return { posted: false, reason: "dormant: DISCORD_RESULTS_WEBHOOK_URL not set" };

  const graded = await gradePending(dateEt);

  // Yesterday's settled card (exclude still-pending), most decisive first.
  const dayPlays = await prisma.postedPlay.findMany({
    where: { postedForDate: dateEt, gradedAt: { not: null }, voided: false },
    orderBy: { ev: "desc" },
  });
  const dayLedger = tallyLedger(dayPlays.map(ledgerInput));

  // Running all-time ledger over every settled (non-void) play.
  const allSettled = await prisma.postedPlay.findMany({
    where: { gradedAt: { not: null }, voided: false },
  });
  const allLedger = tallyLedger(allSettled.map(ledgerInput));

  const label = prettyDate(dateEt);
  const arrow = dayLedger.netUnits >= 0 ? "▲" : "▼";

  // Per-play result lines, length-guarded under Discord's 4096 embed cap.
  let lines = "";
  let shown = 0;
  const rendered = dayPlays.map(resultLine);
  for (const line of rendered) {
    if (lines.length + line.length + 1 > 3400) break;
    lines += (lines ? "\n" : "") + line;
    shown++;
  }
  if (shown < rendered.length) lines += `\n_…+${rendered.length - shown} more_`;

  const header =
    `**${label} card:** ${dayLedger.record}  ${arrow} ${fmtUnits(dayLedger.netUnits)}` +
    `\n**All-time:** ${allLedger.record}  ·  ${fmtUnits(allLedger.netUnits)}`;
  const body = dayPlays.length
    ? `${header}\n\n${lines}`
    : `${header}\n\n_No settled plays for ${label}._`;

  await postWebhook(url, {
    username: "Moses, Leader of Many",
    embeds: [{ title: `📊 Results · ${label}`, description: body, color: ARCHR_GREEN, footer: { text: RESEARCH_FOOTER } }],
  });

  return { posted: true, dayRecord: dayLedger.record, dayUnits: dayLedger.netUnits, graded };
}

async function postWebhook(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord webhook failed: ${res.status} ${res.statusText} — ${text}`);
  }
}
