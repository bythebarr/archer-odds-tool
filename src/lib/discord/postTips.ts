/**
 * #tips — one bet-smarter lesson a day.
 *
 * Resurrected from the old "Moses 101" teaching drop, which the owner liked but
 * which lived in the wrong place (it posted into the free-lean channel, so a
 * pick channel carried lessons). Same rotation, its own home, its own webhook.
 *
 * Content comes from the app's glossary — the same source `/learn` and the
 * in-app InfoTips read — so a term explained in the room and a term explained in
 * the product can never drift apart. Adding a glossary entry adds a lesson.
 *
 * Free-visible on purpose: it's the reason a free member opens the room on a day
 * they aren't getting a play, and it costs nothing to give away.
 */
import { GLOSSARY, type GlossaryEntry } from "@/lib/glossary";
import { todayEt } from "@/lib/dateEt";
import { postWebhook } from "./postCard";
import { mosesAuthor } from "./brand";

const ARCHR_GREEN = 0x06996b;
const RESEARCH_FOOTER =
  "Research/entertainment only · not betting advice · 21+ · gamble responsibly 1-800-522-4700";

/**
 * Every glossary entry EXCEPT the "getting-around" category, which names the
 * private app's own screens (The Slate, the bet slip) and means nothing to
 * someone reading in Discord.
 */
export const TEACHABLE: GlossaryEntry[] = GLOSSARY.filter((e) => e.category !== "getting-around");

/** Whole days since the Unix epoch for an ET date — a stable daily rotation key. */
export function dayIndex(dateEt: string): number {
  return Math.floor(Date.parse(`${dateEt}T00:00:00Z`) / 86_400_000);
}

/**
 * The lesson for a day. Deterministic rotation rather than random: the same date
 * always yields the same tip, so a retry after a failed post can't skip or
 * duplicate a lesson, and the cycle covers every entry before repeating.
 */
export function tipForDate(dateEt: string): GlossaryEntry | null {
  if (!TEACHABLE.length) return null;
  return TEACHABLE[dayIndex(dateEt) % TEACHABLE.length];
}

export interface TipEmbed {
  author: { name: string; url: string; icon_url: string };
  title: string;
  description: string;
  color: number;
  footer: { text: string };
}

/** Pure renderer — unit-tested without touching Discord. */
export function renderTip(entry: GlossaryEntry): TipEmbed {
  const long = entry.long ? `\n\n${entry.long}` : "";
  return {
    author: mosesAuthor(),
    title: `📚 Tip of the day — ${entry.term}`,
    description: `${entry.short}${long}\n\n_A new one every morning. Questions? Ask in chat._ 🏹`,
    color: ARCHR_GREEN,
    footer: { text: RESEARCH_FOOTER },
  };
}

export interface TipPostResult {
  posted: boolean;
  reason?: string;
  term?: string;
}

export async function postDailyTip(dateEt: string = todayEt()): Promise<TipPostResult> {
  const url = process.env.DISCORD_TIPS_WEBHOOK_URL;
  if (!url) return { posted: false, reason: "dormant: DISCORD_TIPS_WEBHOOK_URL not set" };

  const entry = tipForDate(dateEt);
  if (!entry) return { posted: false, reason: "no teachable glossary entries" };

  await postWebhook(url, { username: "Moses, Leader of Many", embeds: [renderTip(entry)] });
  return { posted: true, term: entry.term };
}
