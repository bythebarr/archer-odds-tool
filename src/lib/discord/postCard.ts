import { getOddsPoolForDate, type OddsPlay } from "@/lib/queries/oddsPool";
import { todayEt } from "@/lib/dateEt";
import { formatEv } from "@/lib/odds/format";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { SITE_URL } from "@/lib/siteUrl";

/**
 * Auto-post the day's card to a paid Discord. Reads the exact same priced-play
 * pool that powers the Slate Value board (getOddsPoolForDate) — one source of
 * truth, so what members see matches the site — and posts:
 *   • the full qualifying +EV card → the PREMIUM channel (DISCORD_WEBHOOK_URL)
 *   • one "free lean" (selection only, no EV/book) → the FREE channel funnel
 *     (DISCORD_FREE_WEBHOOK_URL), if that webhook is set.
 *
 * Dormant-safe: with no DISCORD_WEBHOOK_URL set, nothing posts and the caller
 * returns cleanly — the post-discord cron becomes a no-op until you paste a
 * webhook URL. Same posture as the Clerk layer: shippable while inert.
 */

const SPORT_LABEL: Record<string, string> = { mlb: "MLB", tennis: "TEN", soccer: "SOC", ufc: "UFC" };
const KIND_LABEL: Record<string, string> = { ml: "ML", spread: "SPR", total: "TOT", prop: "PROP" };

/** Only plays at or above this MARKET EV clear onto the card. Tune to taste. */
const MIN_EV = 0.03;
/** Cap the premium card so it stays scannable. Pool is pre-sorted by EV desc. */
const MAX_PLAYS = 10;
/** Stamped on every post — keeps the compliance line in front of members daily. */
const RESEARCH_FOOTER =
  "Research/entertainment only · not betting advice · 21+ · gamble responsibly 1-800-522-4700";
/** ARCHR accent green (matches the app's --accent), as a Discord embed color int. */
const ARCHR_GREEN = 0x06996b;

export interface DiscordPostResult {
  posted: boolean;
  reason?: string;
  premiumCount?: number;
  freePosted?: boolean;
}

function tagFor(p: OddsPlay): string {
  return `${SPORT_LABEL[p.sport] ?? p.sport.toUpperCase()} ${KIND_LABEL[p.kind] ?? ""}`.trim();
}

/** e.g. `MLB ML` **Yankees** +118 · FanDuel · +3.2% EV */
function playLine(p: OddsPlay): string {
  return `\`${tagFor(p)}\` **${p.selectionLabel}** ${formatAmerican(p.bestPrice)} · ${p.bestBookName} · ${formatEv(p.ev)} EV`;
}

/** YYYY-MM-DD → "Jul 9" (avoids Date parsing/tz drift on a plain ET date string). */
function prettyDate(dateEt: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, m, d] = dateEt.split("-").map(Number);
  return `${months[m - 1]} ${d}`;
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
  // Pool is already sorted by EV desc; take the qualifying head.
  const picks = plays.filter((p) => p.ev !== null && p.ev >= MIN_EV).slice(0, MAX_PLAYS);
  const label = prettyDate(dateEt);

  const description = picks.length
    ? picks.map(playLine).join("\n")
    : "_No plays cleared the +EV threshold today. Discipline > forcing action._";

  await postWebhook(premiumUrl, {
    username: "Archer",
    embeds: [
      {
        title: `🎯 ARCHR — Today's Card · ${label}`,
        url: `${SITE_URL}/slate`,
        description,
        color: ARCHR_GREEN,
        footer: { text: RESEARCH_FOOTER },
      },
    ],
  });

  // Free channel: a single lean as the funnel tease — selection only, no EV,
  // no best book. The value (the number + where to get it) stays behind the paywall.
  let freePosted = false;
  const freeUrl = process.env.DISCORD_FREE_WEBHOOK_URL;
  if (freeUrl && picks.length) {
    const top = picks[0];
    await postWebhook(freeUrl, {
      username: "Archer",
      embeds: [
        {
          title: `Free lean · ${label}`,
          description:
            `\`${tagFor(top)}\` **${top.selectionLabel}**\n\n` +
            "The full card — every +EV play with the number and best book — is in premium. 🔒",
          color: ARCHR_GREEN,
          footer: { text: RESEARCH_FOOTER },
        },
      ],
    });
    freePosted = true;
  }

  return { posted: true, premiumCount: picks.length, freePosted };
}
