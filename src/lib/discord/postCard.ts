import { getOddsPoolForDate, type OddsPlay } from "@/lib/queries/oddsPool";
import { todayEt } from "@/lib/dateEt";
import { formatEv } from "@/lib/odds/format";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { SITE_URL } from "@/lib/siteUrl";
import { prisma } from "@/lib/prisma";
import { getUfcBestPlays, type UfcBestPlay, type UfcCard } from "./ufcBestPlays";
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
 * A play must beat the price by at least this on Archer's MODEL to make the card
 * (the believability floor). Tune against the paper-log record.
 */
const MIN_ARCHER_EV = 0.03;
/**
 * Believability CEILING. Model edges above this are almost always miscalibration
 * — a data gap (unconfirmed pitcher, stale line), not free money. A capper who
 * posts "+57% EV locks" and goes 3-7 is done. So these are DROPPED from the card
 * (and logged, not silently hidden), never posted. Tune once the paper-log shows
 * where real edges top out. See the Best Plays selection in postDailyCardToDiscord.
 */
const MAX_ARCHER_EV = 0.2;
/** Cap the premium card so it stays a curated capper card, not a dump. */
const MAX_PLAYS = 8;
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

/** e.g. `MLB ML` **Yankees** +118 · FanDuel · +6.2% Archer EV · 1.5u */
function playLine(p: OddsPlay): string {
  const units = p.modelEv !== null ? ` · ${unitsFor(p.modelEv)}u` : "";
  return `\`${tagFor(p)}\` **${p.selectionLabel}** ${formatAmerican(p.bestPrice)} · ${p.bestBookName} · ${formatEv(p.modelEv)} Archer EV${units}`;
}

/**
 * Join play lines into a Discord embed description, staying under the 4096-char
 * embed limit (headroom at 3800). If the card is too long, show what fits and
 * point the rest to the site rather than letting the webhook 400 on us.
 */
function buildDescription(picks: OddsPlay[]): string {
  if (!picks.length) {
    return "_No plays cleared Archer's model today. No card is a card — we don't force action._";
  }
  const lines = picks.map(playLine);
  let out = "";
  let shown = 0;
  for (const line of lines) {
    if (out.length + line.length + 1 > 3800) break;
    out += (out ? "\n" : "") + line;
    shown++;
  }
  if (shown < lines.length) out += `\n_…+${lines.length - shown} more on the board._`;
  return out;
}

/** e.g. 🏆 **Islam Makhachev** over Arman Tsarukyan · 68% fighter-math */
function ufcPlayLine(p: UfcBestPlay): string {
  const marker = p.titleBout ? "🏆 " : "";
  return `${marker}**${p.pickName}** over ${p.opponentName} · ${Math.round(p.prob * 100)}% fighter-math`;
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
  // Select on the MODEL lens (Archer EV), inside the believability band, then
  // sort by it — the pool arrives sorted by MARKET ev, so it MUST be re-sorted
  // by modelEv for a capper card. Plays above the ceiling are model artifacts:
  // dropped (and logged below), never posted.
  const modelPlays = plays.filter((p): p is OddsPlay & { modelEv: number } => p.modelEv !== null);
  const dropped = modelPlays.filter((p) => p.modelEv > MAX_ARCHER_EV);
  const picks = modelPlays
    .filter((p) => p.modelEv >= MIN_ARCHER_EV && p.modelEv <= MAX_ARCHER_EV)
    .sort((a, b) => b.modelEv - a.modelEv)
    .slice(0, MAX_PLAYS);
  if (dropped.length) {
    // No silent caps: surface what we withheld so a systematically-miscalibrated
    // day is visible in the logs, not mistaken for "the model liked nothing."
    console.warn(
      `postCard: withheld ${dropped.length} play(s) above +${Math.round(MAX_ARCHER_EV * 100)}% Archer EV as likely miscalibration (not posted).`
    );
  }
  const label = prettyDate(dateEt);
  const description = buildDescription(picks);

  // Fight-night leans from the fighter-math model — a second embed, only when a
  // UFC card is imminent (getUfcBestPlays returns null otherwise). Best-effort:
  // a UFC-side failure must not block the MLB card that's ready to post.
  let ufcCard: UfcCard | null = null;
  try {
    ufcCard = await getUfcBestPlays();
  } catch (err) {
    console.error("getUfcBestPlays failed (posting MLB card without it):", err);
  }

  await postWebhook(premiumUrl, {
    username: "Archer",
    embeds: [
      {
        title: `🎯 Archer's Best Plays · ${label}`,
        url: `${SITE_URL}/slate`,
        description,
        color: ARCHR_GREEN,
        footer: { text: RESEARCH_FOOTER },
      },
      ...(ufcCard ? [buildUfcEmbed(ufcCard)] : []),
    ],
  });

  // Record what we posted so #results can grade it tomorrow. Best-effort: a DB
  // failure must not fail the post that already went out.
  try {
    await recordPostedPlays(dateEt, picks);
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
      ? `\`${tagFor(freeMlb)}\` **${freeMlb.selectionLabel}**`
      : `\`UFC\` **${freeUfc!.pickName}** over ${freeUfc!.opponentName}`;
    await postWebhook(freeUrl, {
      username: "Archer",
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
