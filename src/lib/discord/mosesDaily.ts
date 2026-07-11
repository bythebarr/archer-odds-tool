import { getOddsPoolForDate } from "@/lib/queries/oddsPool";
import { getUfcBestPlays, type UfcCard } from "./ufcBestPlays";
import { ensureUfcOddsFresh } from "@/lib/ufc/refreshOddsOnView";
import { GLOSSARY, type GlossaryEntry } from "@/lib/glossary";
import { todayEt } from "@/lib/dateEt";
import { postWebhook } from "./postCard";

/**
 * Moses's daily rhythm — the posts that keep the room alive AROUND the 1pm Card
 * of the Day, so Moses is a presence, not a once-a-day drop. All of it runs on
 * FREE data (the odds pool we already hold + the Cito UFC feed + the static
 * glossary) — zero incremental Odds API spend, by design (see the free-forever
 * decision in the project memory).
 *
 * Two posts today:
 *   • Morning Slate Drop (~9am ET) — "Moses is up", today's board + fight-week flag
 *   • Moses 101 (~11:30am ET) — a rotating one-lesson explainer from the glossary
 *
 * Dormant-safe: both post to DISCORD_MOSES_WEBHOOK_URL and no-op when it's unset,
 * exactly like the card (DISCORD_WEBHOOK_URL) and recap (DISCORD_RESULTS_WEBHOOK_URL).
 * Point it at the room's channel to light Moses up. The preview page renders both
 * with real data regardless, so they can be reviewed before the webhook is set.
 */

const ARCHR_GREEN = 0x06996b;
const RESEARCH_FOOTER =
  "Research/entertainment only · not betting advice · 21+ · gamble responsibly 1-800-522-4700";

export interface MosesPostResult {
  posted: boolean;
  reason?: string;
}

interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  footer: { text: string };
}

/** YYYY-MM-DD → "Jul 11" (avoids Date parsing/tz drift on a plain ET date). */
function prettyDate(dateEt: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, m, d] = dateEt.split("-").map(Number);
  return `${months[m - 1]} ${d}`;
}

/** A Date → "1:05 PM ET" in America/New_York. */
function prettyTime(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(d);
}

/** UFC event Date → "Sat Jul 12" in ET. */
function prettyEventDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(d);
}

// ── Morning Slate Drop ──────────────────────────────────────────────────────

export interface MorningData {
  dateEt: string;
  /** Distinct MLB games on today's board. */
  mlbGames: number;
  /** Earliest / latest first pitch today, or null on an empty board. */
  firstPitch: Date | null;
  lastPitch: Date | null;
  /** Imminent UFC card (within the fighter-math lookahead), or null. */
  ufc: UfcCard | null;
}

/** Pull the free inputs for the morning drop — distinct MLB games + UFC fight-week flag. */
export async function getMorningData(dateEt: string = todayEt()): Promise<MorningData> {
  const { plays } = await getOddsPoolForDate(dateEt);
  const mlb = plays.filter((p) => p.sport === "mlb");
  const byGame = new Map<string, Date>();
  for (const p of mlb) byGame.set(p.matchId, p.startUtc);
  const starts = [...byGame.values()].sort((a, b) => a.getTime() - b.getTime());

  let ufc: UfcCard | null = null;
  try {
    await ensureUfcOddsFresh();
    ufc = await getUfcBestPlays();
  } catch {
    // Best-effort — a UFC-side failure just drops the fight-week line.
  }

  return {
    dateEt,
    mlbGames: byGame.size,
    firstPitch: starts[0] ?? null,
    lastPitch: starts.length ? starts[starts.length - 1] : null,
    ufc,
  };
}

/** Render the morning drop embed from its inputs (pure — unit-tested). */
export function renderMorningDrop(data: MorningData): DiscordEmbed {
  const label = prettyDate(data.dateEt);
  const fightWeek = data.ufc
    ? `\n🥊 **Fight week:** ${data.ufc.eventTitle} · ${prettyEventDate(data.ufc.eventDate)}`
    : "";

  let body: string;
  if (data.mlbGames === 0) {
    body =
      "Light board today — no MLB games on the slate yet." +
      fightWeek +
      "\n\nMoses is still watching. 🏹";
  } else {
    const window =
      data.firstPitch && data.lastPitch
        ? data.firstPitch.getTime() === data.lastPitch.getTime()
          ? `First pitch **${prettyTime(data.firstPitch)}**.`
          : `First pitch **${prettyTime(data.firstPitch)}** · last one **${prettyTime(data.lastPitch)}**.`
        : "";
    body =
      `Moses is up. **${data.mlbGames} MLB game${data.mlbGames === 1 ? "" : "s"}** on the board today. ${window}`.trim() +
      fightWeek +
      "\n\nThe full card — every play with the number — drops at **1 PM ET**. Let's eat. 🏹";
  }

  return {
    title: `☀️ Good morning — ${label}`,
    description: body,
    color: ARCHR_GREEN,
    footer: { text: RESEARCH_FOOTER },
  };
}

export async function postMorningDrop(dateEt: string = todayEt()): Promise<MosesPostResult> {
  const url = process.env.DISCORD_MOSES_WEBHOOK_URL;
  if (!url) return { posted: false, reason: "dormant: DISCORD_MOSES_WEBHOOK_URL not set" };
  const embed = renderMorningDrop(await getMorningData(dateEt));
  await postWebhook(url, { username: "Moses, Leader of Many", embeds: [embed] });
  return { posted: true };
}

// ── Moses 101 (teaching drop) ───────────────────────────────────────────────

/**
 * The lessons worth teaching a betting room — every glossary entry EXCEPT the
 * "getting-around" category, which names the private app's own screens (The
 * Slate, Bet slip) and means nothing to someone in the Discord.
 */
export const TEACHABLE: GlossaryEntry[] = GLOSSARY.filter((e) => e.category !== "getting-around");

/** Whole-day index since the Unix epoch for an ET date — a stable daily rotation key. */
export function dayIndex(dateEt: string): number {
  return Math.floor(Date.parse(`${dateEt}T00:00:00Z`) / 86_400_000);
}

/** The lesson for a given day — rotates through TEACHABLE, one per day, deterministically. */
export function lessonForDate(dateEt: string): GlossaryEntry {
  return TEACHABLE[dayIndex(dateEt) % TEACHABLE.length];
}

/** Render the Moses 101 embed for a lesson (pure — unit-tested). */
export function renderTeachingDrop(entry: GlossaryEntry): DiscordEmbed {
  const long = entry.long ? `\n\n${entry.long}` : "";
  return {
    title: `📚 Moses 101 — ${entry.term}`,
    description: `${entry.short}${long}\n\n_A new lesson every morning. Questions? Drop 'em in chat._ 🏹`,
    color: ARCHR_GREEN,
    footer: { text: RESEARCH_FOOTER },
  };
}

export async function postTeachingDrop(dateEt: string = todayEt()): Promise<MosesPostResult> {
  const url = process.env.DISCORD_MOSES_WEBHOOK_URL;
  if (!url) return { posted: false, reason: "dormant: DISCORD_MOSES_WEBHOOK_URL not set" };
  const embed = renderTeachingDrop(lessonForDate(dateEt));
  await postWebhook(url, { username: "Moses, Leader of Many", embeds: [embed] });
  return { posted: true };
}
