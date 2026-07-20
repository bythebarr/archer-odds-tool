import { prisma } from "@/lib/prisma";
import { todayEt } from "@/lib/dateEt";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { getAdapter, postedPlayToPlay } from "@/lib/engine";
import { gradeUfcMoneyline, tallyLedger, currentStreak, type PlayResult } from "./gradePlay";
import { mosesAuthor } from "./brand";
import type { PostedPlay, PlayStream } from "@/generated/prisma/client";

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
 * TWO ledgers, never merged (owner's 2026-07-20 call): the premium #todays-card
 * handpicks and the single daily #free-play are graded into separate records, so
 * the free play can neither flatter nor drag the premium number. Both are posted
 * to #results, which free members can see — the premium record is the proof
 * they're shopping. The unstaked #ev-slate is absent from both by construction:
 * the poster never records it.
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
  /** The premium card's day record ("3-1-0"). */
  dayRecord?: string;
  dayUnits?: number;
  /** The free play's day record, tracked separately. */
  freeRecord?: string;
  freeUnits?: number;
  graded?: number;
}

/** Yesterday's ET date (games settle overnight; the recap runs the next morning). */
export function yesterdayEt(): string {
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

/**
 * Settle every still-pending play for a date against final results. Dispatch runs
 * through the sport engine's registry: each play is rehydrated into a `Play` and
 * handed to its adapter's `grade`. A sport with no registered adapter is
 * no-action (voided out of the record, as tennis/soccer always were); an adapter
 * that returns `"pending"` leaves the row unsettled for a later pass (event not
 * final, a prop's game log not yet synced) — never a fake loss or premature void.
 * The per-sport grading rules now live inside the adapters (src/lib/engine).
 */
export async function gradePending(dateEt: string): Promise<number> {
  const pending = await prisma.postedPlay.findMany({
    where: { postedForDate: dateEt, gradedAt: null },
  });

  let graded = 0;
  for (const play of pending) {
    const adapter = getAdapter(play.sport);
    if (!adapter) {
      await settlePlay(play.id, "void"); // unknown sport — no-action
      graded++;
      continue;
    }
    const result = await adapter.grade(postedPlayToPlay(play));
    if (result === "pending") continue; // not settleable yet — leave for a later pass
    await settlePlay(play.id, result);
    graded++;
  }
  return graded;
}

/**
 * The settle state of every tracked play for a date — what the results tick
 * needs to decide "is the day done?" without pulling whole rows. Only staked
 * streams exist in this table, so no stream filter is needed: the unstaked
 * slate is never recorded in the first place.
 */
export async function trackedSettleStates(dateEt: string): Promise<Array<{ gradedAt: Date | null }>> {
  return prisma.postedPlay.findMany({
    where: { postedForDate: dateEt },
    select: { gradedAt: true },
  });
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

export interface StreamRecap {
  body: string;
  dayRecord: string;
  dayUnits: number;
  /** Whether this stream has any settled history at all — an empty one is skipped. */
  hasHistory: boolean;
}

/**
 * Build one stream's recap block: the day's line, the running all-time ledger,
 * last-10 once there's more history than the window, the hot/cold streak, and
 * every settled play. Streams are queried independently — never summed — so the
 * premium and free numbers stay honestly separate.
 */
async function recapForStream(stream: PlayStream, dateEt: string, label: string): Promise<StreamRecap> {
  const dayPlays = await prisma.postedPlay.findMany({
    where: { stream, postedForDate: dateEt, gradedAt: { not: null }, voided: false },
    orderBy: { ev: "desc" },
  });
  // Chronological, so streak + last-10 read from the most recent plays.
  const allSettled = await prisma.postedPlay.findMany({
    where: { stream, gradedAt: { not: null }, voided: false },
    orderBy: [{ postedForDate: "asc" }, { gradedAt: "asc" }],
  });
  return buildStreamRecap(dayPlays, allSettled, label);
}

/**
 * The recap's rendering, split from its queries so it can be exercised with
 * fabricated rows — a results post otherwise can't be reviewed until a real day
 * has settled, which is far too late to discover the copy reads wrong.
 */
export function buildStreamRecap(
  dayPlays: PostedPlay[],
  allSettled: PostedPlay[],
  label: string
): StreamRecap {
  const dayLedger = tallyLedger(dayPlays.map(ledgerInput));
  const allLedger = tallyLedger(allSettled.map(ledgerInput));
  const last10 = tallyLedger(allSettled.slice(-10).map(ledgerInput));
  const streak = currentStreak(allSettled.map((p) => ledgerInput(p).result));

  const arrow = dayLedger.netUnits >= 0 ? "▲" : "▼";
  // The "hot hand": only surface a run of 3+ (a real heater or cold snap, not
  // noise). A cold streak is shown too — the record never hides a skid.
  const streakTag =
    streak && streak.length >= 3
      ? `   ${streak.result === "hit" ? "🔥" : "🧊"} ${streak.result === "hit" ? "W" : "L"}${streak.length}`
      : "";

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
    `**${label}:** ${dayLedger.record}  ${arrow} ${fmtUnits(dayLedger.netUnits)}` +
    `\n**All-time:** ${allLedger.record}  ·  ${fmtUnits(allLedger.netUnits)}${streakTag}` +
    (allSettled.length > 10 ? `\n**Last 10:** ${last10.record}  ·  ${fmtUnits(last10.netUnits)}` : "");

  return {
    body: dayPlays.length ? `${header}\n\n${lines}` : `${header}\n\n_No settled plays for ${label}._`,
    dayRecord: dayLedger.record,
    dayUnits: dayLedger.netUnits,
    hasHistory: allSettled.length > 0 || dayPlays.length > 0,
  };
}

/**
 * The posted embeds. Shared by the live poster and the test-post harness, so a
 * preview can never drift from what actually goes out.
 */
export function buildRecapEmbeds(
  card: StreamRecap,
  free: StreamRecap,
  label: string
): Record<string, unknown>[] {
  // The premium record always posts — it's the trust spine, and a silent day
  // reads as a hidden day. The free block appears once it has any history.
  const embeds: Record<string, unknown>[] = [
    {
      author: mosesAuthor(),
      title: `👑 Premium Card · Results · ${label}`,
      description: card.body,
      color: ARCHR_GREEN,
      ...(free.hasHistory ? {} : { footer: { text: RESEARCH_FOOTER } }),
    },
  ];
  if (free.hasHistory) {
    embeds.push({
      title: `🎯 Free Play · Results · ${label}`,
      description: `${free.body}\n\n_Tracked separately from the premium card — never merged._`,
      color: ARCHR_GREEN,
      footer: { text: RESEARCH_FOOTER },
    });
  }
  return embeds;
}

export async function postResultsRecap(dateEt: string = yesterdayEt()): Promise<ResultsPostResult> {
  const url = process.env.DISCORD_RESULTS_WEBHOOK_URL;
  if (!url) return { posted: false, reason: "dormant: DISCORD_RESULTS_WEBHOOK_URL not set" };

  const graded = await gradePending(dateEt);
  const label = prettyDate(dateEt);

  const card = await recapForStream("card", dateEt, label);
  const free = await recapForStream("free", dateEt, label);

  await postWebhook(url, {
    username: "Moses, Leader of Many",
    embeds: buildRecapEmbeds(card, free, label),
  });

  return {
    posted: true,
    dayRecord: card.dayRecord,
    dayUnits: card.dayUnits,
    freeRecord: free.dayRecord,
    freeUnits: free.dayUnits,
    graded,
  };
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
