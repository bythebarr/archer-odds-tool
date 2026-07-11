import { getOddsPoolForDate, type OddsPlay } from "@/lib/queries/oddsPool";
import { todayEt } from "@/lib/dateEt";
import { formatEv } from "@/lib/odds/format";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { SITE_URL } from "@/lib/siteUrl";
import { prisma } from "@/lib/prisma";
import { getUfcBestPlays, type UfcBestPlay, type UfcCard, type UfcFinishLean } from "./ufcBestPlays";
import { ensureUfcOddsFresh } from "@/lib/ufc/refreshOddsOnView";
import type { Sport, MarketType } from "@/generated/prisma/client";

/**
 * Auto-post Archer's Best Plays to a paid Discord — the capper product, not a
 * line-shopping feed. Reads the same priced-play pool that powers the Slate
 * (getOddsPoolForDate) but selects on the MODEL lens (`modelEv` — Archer's own
 * probability vs the price), NOT the market/consensus lens (`ev`). The model
 * lens is the differentiator: "my model found these," not "here's every book's
 * price." It's MLB game-lines only today (props/UFC/F1/tennis/soccer have no
 * game-line model yet — UFC fighter-math is a separate feed, wired later).
 *
 * Posts:
 *   • the curated Best Plays card → the PREMIUM channel (DISCORD_WEBHOOK_URL)
 *   • one "free lean" (selection only, no EV/book) → the FREE channel funnel
 *     (DISCORD_FREE_WEBHOOK_URL), if that webhook is set.
 *
 * Dormant-safe: with no DISCORD_WEBHOOK_URL set, nothing posts and the caller
 * returns cleanly — the post-discord cron becomes a no-op until you paste a
 * webhook URL. Same posture as the Clerk layer: shippable while inert.
 */

const SPORT_LABEL: Record<string, string> = { mlb: "MLB", tennis: "TEN", soccer: "SOC", ufc: "UFC" };
const KIND_LABEL: Record<string, string> = { ml: "ML", spread: "SPR", total: "TOT", prop: "PROP" };

/**
 * The premium card posts EVERY positive-Archer-EV play — no edge floor, no
 * ceiling, no count cap (product decision: paid members get the full model
 * board, they judge for themselves). The only governor is sizing: unitsFor
 * caps every play at 2u, so even a +40% model edge posts at 2u, never as a
 * "lock". NB: the UFC fight-night leans keep their own believability band in
 * ufcBestPlays.ts, because that model isn't market-calibrated yet.
 */
/** Leave 1 of Discord's 10-embed limit for the UFC embed. */
const MAX_PREMIUM_EMBEDS = 9;
/** Stamped on every post — keeps the compliance line in front of members daily. */
const RESEARCH_FOOTER =
  "Research/entertainment only · not betting advice · 21+ · gamble responsibly 1-800-522-4700";
/** ARCHR accent green (matches the app's --accent), as a Discord embed color int. */
const ARCHR_GREEN = 0x06996b;
/** UFC fight-night red — visually separates the fighter-math section from the +EV card. */
const UFC_RED = 0xd20a0a;

export interface DiscordPostResult {
  posted: boolean;
  reason?: string;
  premiumCount?: number;
  freePosted?: boolean;
  ufcCount?: number;
}

function tagFor(p: OddsPlay): string {
  return `${SPORT_LABEL[p.sport] ?? p.sport.toUpperCase()} ${KIND_LABEL[p.kind] ?? ""}`.trim();
}

/**
 * Stake in units, scaled by edge — the "units not dollars" discipline every
 * credible picks room runs on (and the compliance-safe way to size a play:
 * never a dollar amount). Capped at 2u so nothing ever reads as reckless.
 */
export function unitsFor(ev: number): number {
  if (ev >= 0.08) return 2;
  if (ev >= 0.05) return 1.5;
  return 1; // anything from MIN_ARCHER_EV up to +5%
}

/** away @ home, using book abbreviations when available (e.g. "NYY @ BOS"). */
function matchupLabel(p: OddsPlay): string {
  return `${p.away.meta ?? p.away.name} @ ${p.home.meta ?? p.home.name}`;
}

/**
 * The member-facing selection. Moneyline/spread name a team so they're self-
 * identifying, but a total ("Over 8.5") or draw names no game — so prefix the
 * matchup, else members see a line with no idea WHICH game it's on.
 */
export function selectionDisplay(p: OddsPlay): string {
  const needsMatchup = p.side === "over" || p.side === "under" || p.side === "draw";
  return needsMatchup ? `${matchupLabel(p)} ${p.selectionLabel}` : p.selectionLabel;
}

/** e.g. `MLB TOT` **NYY @ BOS Over 8.5** +102 · FanDuel · +6.2% Archer EV · 1.5u */
export function playLine(p: OddsPlay): string {
  const units = p.modelEv !== null ? ` · ${unitsFor(p.modelEv)}u` : "";
  return `\`${tagFor(p)}\` **${selectionDisplay(p)}** ${formatAmerican(p.bestPrice)} · ${p.bestBookName} · ${formatEv(p.modelEv)} Archer EV${units}`;
}

const EMPTY_CARD =
  "_No plays cleared Archer's model today. No card is a card — we don't force action._";

/**
 * The full premium body as one string (all lines, newline-joined) — used by the
 * on-demand preview page, a scrolling web view with no length limit.
 */
function buildDescription(picks: OddsPlay[]): string {
  if (!picks.length) return EMPTY_CARD;
  return picks.map(playLine).join("\n");
}

/**
 * Discord embed descriptions cap at 4096 chars, and we now post EVERY positive
 * play, so a big slate can exceed one embed. Pack the lines into as many ≤4000-
 * char chunks as needed — each becomes its own embed — so nothing is truncated.
 */
function packDescriptions(picks: OddsPlay[], limit = 4000): string[] {
  if (!picks.length) return [EMPTY_CARD];
  const chunks: string[] = [];
  let cur = "";
  for (const line of picks.map(playLine)) {
    if (cur && cur.length + line.length + 1 > limit) {
      chunks.push(cur);
      cur = "";
    }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

const FINISH_METHOD_LABEL: Record<string, string> = { ko: "KO/TKO", submission: "submission", decision: "decision" };

/**
 * The fighter-math finish lean, in the card's analyst voice — "sees KO/TKO ~R2
 * (61% finish)" for a stoppage read, "sees a decision (55% to distance)" for a
 * points read. Turns the raw EV into a breakdown a capper would actually write.
 */
function finishLeanLabel(lean: UfcFinishLean): string {
  if (lean.method === "decision") {
    return `sees a decision (${Math.round(lean.distanceProb * 100)}% to distance)`;
  }
  const method = FINISH_METHOD_LABEL[lean.method];
  const round = lean.round ? ` ~R${lean.round}` : "";
  return `sees ${method}${round} (${Math.round(lean.finishProb * 100)}% finish)`;
}

/** e.g. 🏆 **Alessandro Costa** +150 · DraftKings · +7.2% Archer EV · 1.5u · over Ode' Osbourne (58% model) · sees KO/TKO ~R2 (61% finish) */
function ufcPlayLine(p: UfcBestPlay): string {
  const marker = p.titleBout ? "🏆 " : "";
  const lean = p.finishLean ? ` · ${finishLeanLabel(p.finishLean)}` : "";
  return (
    `${marker}**${p.pickName}** ${formatAmerican(p.bestPrice)} · ${p.bestBookName} · ` +
    `${formatEv(p.archerEv)} Archer EV · ${unitsFor(p.archerEv)}u · over ${p.opponentName} (${Math.round(p.prob * 100)}% model)${lean}`
  );
}

/** UFC event date → "Sat Jul 12" in ET (mirrors the /ufc list's formatter). */
function prettyEventDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(date);
}

/**
 * The fight-night embed: fighter-math's best leans on the next card. A model
 * lens with a confidence %, not +EV (UFC has no odds) — see ufcBestPlays.ts.
 */
function buildUfcEmbed(card: UfcCard) {
  return {
    title: `🥊 Fight Night — ${card.eventTitle} · ${prettyEventDate(card.eventDate)}`,
    url: `${SITE_URL}/ufc`,
    description: card.plays.map(ufcPlayLine).join("\n"),
    color: UFC_RED,
    footer: { text: RESEARCH_FOOTER },
  };
}

/** YYYY-MM-DD → "Jul 9" (avoids Date parsing/tz drift on a plain ET date string). */
function prettyDate(dateEt: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, m, d] = dateEt.split("-").map(Number);
  return `${months[m - 1]} ${d}`;
}

/**
 * Persist the plays we just posted so #results can grade them tomorrow (see
 * postResults.ts). Upsert keyed on (date, playKey): a re-post of the same day
 * leaves the original row (and its grade) untouched. Best-effort — the caller
 * swallows failures so a DB hiccup never blocks the Discord post itself.
 */
async function recordPostedPlays(dateEt: string, picks: OddsPlay[]): Promise<void> {
  await Promise.all(
    picks.map((p) =>
      prisma.postedPlay.upsert({
        where: { postedForDate_playKey: { postedForDate: dateEt, playKey: p.key } },
        update: {},
        create: {
          postedForDate: dateEt,
          playKey: p.key,
          sport: p.sport as Sport,
          matchId: p.matchId,
          market: (p.market as MarketType | null) ?? null,
          kind: p.kind,
          side: p.side,
          point: p.point,
          selectionLabel: p.selectionLabel,
          bestPrice: p.bestPrice,
          bestBookName: p.bestBookName,
          // Store the Archer (model) EV we actually posted on — units derive from
          // it, and #results grades on units/price/result, not this field.
          ev: p.modelEv,
          units: p.modelEv !== null ? unitsFor(p.modelEv) : 1,
          mlbPlayerId: p.mlbPlayerId ?? null,
          statCategory: p.statCategory ?? null,
        },
      })
    )
  );
}

/** ET calendar date (YYYY-MM-DD) for a Date — en-CA formats as YYYY-MM-DD. */
function etDateString(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Persist UFC Archer EV plays so #results grades them after fight night. Unlike
 * the MLB card (posted for today, settled tomorrow), a UFC play is recorded
 * under its FIGHT'S ET date, so it settles the day after the bout no matter how
 * many days early we teased the card — and daily re-posts across the week dedupe
 * to one row per (fight-date, bout, side). Best-effort, like recordPostedPlays.
 */
async function recordUfcPostedPlays(card: UfcCard): Promise<void> {
  const postedForDate = etDateString(card.eventDate);
  await Promise.all(
    card.plays.map((p) =>
      prisma.postedPlay.upsert({
        where: { postedForDate_playKey: { postedForDate, playKey: `ufc:${p.boutId}:${p.side}` } },
        update: {},
        create: {
          postedForDate,
          playKey: `ufc:${p.boutId}:${p.side}`,
          sport: "ufc",
          matchId: p.boutId,
          market: "h2h",
          kind: "ml",
          side: p.side,
          point: null,
          selectionLabel: p.pickName,
          bestPrice: p.bestPrice,
          bestBookName: p.bestBookName,
          ev: p.archerEv,
          units: unitsFor(p.archerEv),
          mlbPlayerId: null,
          statCategory: null,
        },
      })
    )
  );
}

export interface DailyCardPreview {
  label: string;
  /** Rendered premium-embed body — exactly what would post to DISCORD_WEBHOOK_URL. */
  premium: string;
  /** Rendered fight-night embed body, or null when no UFC card is imminent. */
  ufc: string | null;
  ufcTitle: string | null;
  premiumCount: number;
  ufcCount: number;
  /** Plays the model liked but withheld as above-ceiling (likely miscalibration). */
  withheldCount: number;
}

/**
 * Assemble the daily card EXACTLY as postDailyCardToDiscord would — same pool,
 * same MODEL-lens selection, same believability band, same formatters — but
 * post nothing and record nothing. The dry-run behind a "show me what it'd
 * post" preview (and a handy test/debug hook), so the card can be inspected
 * before a webhook is ever wired.
 */
export async function previewDailyCard(dateEt: string = todayEt()): Promise<DailyCardPreview> {
  const { plays } = await getOddsPoolForDate(dateEt);
  const modelPlays = plays.filter((p): p is OddsPlay & { modelEv: number } => p.modelEv !== null);
  const picks = modelPlays.filter((p) => p.modelEv > 0).sort((a, b) => b.modelEv - a.modelEv);

  let ufcCard: UfcCard | null = null;
  try {
    await ensureUfcOddsFresh();
    ufcCard = await getUfcBestPlays();
  } catch {
    // Best-effort, mirrors the poster: a UFC-side failure just drops that embed.
  }
  const ufcEmbed = ufcCard ? buildUfcEmbed(ufcCard) : null;

  return {
    label: prettyDate(dateEt),
    premium: buildDescription(picks),
    ufc: ufcEmbed?.description ?? null,
    ufcTitle: ufcEmbed?.title ?? null,
    premiumCount: picks.length,
    ufcCount: ufcCard?.plays.length ?? 0,
    withheldCount: 0, // nothing is withheld now — every positive play posts
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

export async function postDailyCardToDiscord(dateEt: string = todayEt()): Promise<DiscordPostResult> {
  const premiumUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!premiumUrl) return { posted: false, reason: "dormant: DISCORD_WEBHOOK_URL not set" };

  const { plays } = await getOddsPoolForDate(dateEt);
  // EVERY positive-model-EV play, sorted by edge. The pool arrives sorted by
  // MARKET ev, so it MUST be re-sorted by modelEv for a capper card. No floor,
  // no ceiling, no count cap — 2u sizing is the only governor (see unitsFor).
  const modelPlays = plays.filter((p): p is OddsPlay & { modelEv: number } => p.modelEv !== null);
  const picks = modelPlays.filter((p) => p.modelEv > 0).sort((a, b) => b.modelEv - a.modelEv);
  const label = prettyDate(dateEt);
  const premiumChunks = packDescriptions(picks);
  if (premiumChunks.length > MAX_PREMIUM_EMBEDS) {
    // No silent caps: a card this big (~360+ plays) means something's off upstream.
    console.warn(
      `postCard: ${premiumChunks.length} premium chunks exceeds ${MAX_PREMIUM_EMBEDS}; posting the first ${MAX_PREMIUM_EMBEDS}.`
    );
  }

  // Fight-night leans from the fighter-math model — a second embed, only when a
  // UFC card is imminent (getUfcBestPlays returns null otherwise). Best-effort:
  // a UFC-side failure must not block the MLB card that's ready to post.
  let ufcCard: UfcCard | null = null;
  try {
    // Price the fight-night card against current lines (gated poll — no-op if
    // fresh). Best-effort: a UFC-side failure must not block the MLB card.
    await ensureUfcOddsFresh();
    ufcCard = await getUfcBestPlays();
  } catch (err) {
    console.error("getUfcBestPlays failed (posting MLB card without it):", err);
  }

  // One embed per description chunk — title/link on the first, footer on the
  // last — then the UFC fight-night embed. Discord allows up to 10 embeds/message.
  const premiumEmbeds = premiumChunks.slice(0, MAX_PREMIUM_EMBEDS).map((desc, i, arr) => ({
    ...(i === 0 ? { title: `🎯 Archer's Best Plays · ${label}`, url: `${SITE_URL}/slate` } : {}),
    description: desc,
    color: ARCHR_GREEN,
    ...(i === arr.length - 1 ? { footer: { text: RESEARCH_FOOTER } } : {}),
  }));
  await postWebhook(premiumUrl, {
    username: "Moses, Leader of Many",
    embeds: [...premiumEmbeds, ...(ufcCard ? [buildUfcEmbed(ufcCard)] : [])],
  });

  // Record what we posted so #results can grade it. Best-effort: a DB failure
  // must not fail the post that already went out. UFC plays are recorded under
  // their fight date (settled the day after the bout), MLB under today's card date.
  try {
    await recordPostedPlays(dateEt, picks);
    if (ufcCard) await recordUfcPostedPlays(ufcCard);
  } catch (err) {
    console.error("recordPostedPlays failed (card was still posted):", err);
  }

  // Free channel: a single lean as the funnel tease — selection only, no EV,
  // no best book. The value (the number + where to get it) stays behind the
  // paywall. Prefer the top MLB play; on an MLB-dry fight day, tease the top
  // UFC lean instead so the funnel still fires when there's a card to sell.
  let freePosted = false;
  const freeUrl = process.env.DISCORD_FREE_WEBHOOK_URL;
  const freeMlb = picks[0];
  const freeUfc = ufcCard?.plays[0];
  if (freeUrl && (freeMlb || freeUfc)) {
    const lean = freeMlb
      ? `\`${tagFor(freeMlb)}\` **${selectionDisplay(freeMlb)}**`
      : `\`UFC\` **${freeUfc!.pickName}** over ${freeUfc!.opponentName}`;
    await postWebhook(freeUrl, {
      username: "Moses, Leader of Many",
      embeds: [
        {
          title: `Free lean · ${label}`,
          description:
            `${lean}\n\n` +
            "The full card — every play with the number and best book — is in premium. 🔒",
          color: ARCHR_GREEN,
          footer: { text: RESEARCH_FOOTER },
        },
      ],
    });
    freePosted = true;
  }

  return { posted: true, premiumCount: picks.length, freePosted, ufcCount: ufcCard?.plays.length ?? 0 };
}
