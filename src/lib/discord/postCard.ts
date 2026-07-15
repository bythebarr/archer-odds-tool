import { todayEt } from "@/lib/dateEt";
import { SITE_URL } from "@/lib/siteUrl";
import { prisma } from "@/lib/prisma";
import { unitsFor } from "@/lib/betting/kelly";
import { mosesAuthor } from "./brand";
import { SPORTS, type Play } from "@/lib/engine";

/**
 * Auto-post Archer's Best Plays to a paid Discord — the capper product, not a
 * line-shopping feed. The board is now assembled from the sport engine: every
 * registered adapter's `listPlays` returns normalized, pre-priced `Play`s already
 * rendered in that sport's capper voice (`display.line`), so this file just
 * groups by sport, renders sections, records, and teases — with no "is this MLB?"
 * branch. MLB carries the model (+EV) lens; UFC brings its fighter-math leans as
 * a second section. (sport-engine Phase 3 — the board wired to the registry.)
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

// Line/selection formatters moved to the neutral @/lib/card/line so the engine
// adapters can pre-render each play's line without importing this Discord layer.
// Re-exported here so existing importers — and postCard.test.ts — keep resolving
// them (and unitsFor) from this module.
export { unitsFor };
export { selectionDisplay, playLine } from "@/lib/card/line";

/**
 * The premium card posts EVERY positive-Archer-EV play — no edge floor, no
 * ceiling, no count cap (product decision: paid members get the full model
 * board, they judge for themselves). Conviction shows in the STAKE, not a
 * filter: each adapter sizes every play by Kelly (edge × odds), hard-capped by
 * price so long-priced dogs never get fat (see @/lib/betting/kelly).
 */
/** Discord allows 10 embeds/message; reserve 1 for a non-primary section (UFC). */
const MAX_EMBEDS = 10;
const MAX_PRIMARY_CHUNKS = MAX_EMBEDS - 1;
/** Stamped on every post — keeps the compliance line in front of members daily. */
const RESEARCH_FOOTER =
  "Research/entertainment only · not betting advice · 21+ · gamble responsibly 1-800-522-4700";
/** ARCHR accent green (matches the app's --accent), as a Discord embed color int. */
const ARCHR_GREEN = 0x06996b;
/** UFC fight-night red — visually separates the fighter-math section from the +EV card. */
const UFC_RED = 0xd20a0a;

/**
 * Per-sport board-section chrome (embed color, deep link, title prefix). Keyed by
 * registry sportKey; the dynamic half of the title (UFC's event + date) rides on
 * `play.display.sectionLabel`, so the primary MLB card uses the date label and UFC
 * appends its event. This is the last sport-keyed literal in the poster; it
 * collapses when the todays-board / tracked-plays channel split lands (the card's
 * shape changes there anyway). Sports absent from this map fall back to green/root.
 */
const SECTION_CHROME: Record<string, { color: number; url: string; titlePrefix: string }> = {
  mlb: { color: ARCHR_GREEN, url: `${SITE_URL}/slate`, titlePrefix: "🎯 ARCHR Edge · Best Plays · " },
  ufc: { color: UFC_RED, url: `${SITE_URL}/ufc`, titlePrefix: "🥊 Fight Night — " },
};

export interface DiscordPostResult {
  posted: boolean;
  reason?: string;
  premiumCount?: number;
  freePosted?: boolean;
  ufcCount?: number;
}

const EMPTY_CARD =
  "_No plays cleared ARCHR Edge today. No card is a card — we don't force action._";

/** YYYY-MM-DD → "Jul 9" (avoids Date parsing/tz drift on a plain ET date string). */
function prettyDate(dateEt: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, m, d] = dateEt.split("-").map(Number);
  return `${months[m - 1]} ${d}`;
}

/**
 * Discord embed descriptions cap at 4096 chars, and we post EVERY positive play,
 * so a big section can exceed one embed. Pack the lines into as many ≤4000-char
 * chunks as needed — each becomes its own embed — so nothing is truncated.
 */
function packLines(lines: string[], limit = 4000): string[] {
  if (!lines.length) return [EMPTY_CARD];
  const chunks: string[] = [];
  let cur = "";
  for (const line of lines) {
    if (cur && cur.length + line.length + 1 > limit) {
      chunks.push(cur);
      cur = "";
    }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

interface BoardSection {
  sportKey: string;
  title: string;
  url: string;
  color: number;
  /** Rendered member lines for this sport, in the order the adapter returned them. */
  lines: string[];
  count: number;
}

/**
 * Group the registry's plays into board sections, in registry order. The primary
 * sport (registry index 0, MLB) is ALWAYS rendered — empty means the "no card is
 * a card" message, not a missing section — while other sports appear only when
 * they have plays. Section title = chrome prefix + the play's own sectionLabel
 * (UFC's event) or the card's date label (MLB).
 */
export function assembleSections(plays: Play[], dateLabel: string): BoardSection[] {
  const byKey = new Map<string, Play[]>();
  for (const p of plays) {
    const arr = byKey.get(p.sportKey) ?? [];
    arr.push(p);
    byKey.set(p.sportKey, arr);
  }
  const primaryKey = SPORTS[0]?.key;
  const sections: BoardSection[] = [];
  for (const adapter of SPORTS) {
    const group = byKey.get(adapter.key) ?? [];
    if (!group.length && adapter.key !== primaryKey) continue; // only the primary shows empty
    const chrome = SECTION_CHROME[adapter.key] ?? {
      color: ARCHR_GREEN,
      url: SITE_URL,
      titlePrefix: `${adapter.meta.label} · `,
    };
    const sectionLabel = group[0]?.display?.sectionLabel ?? dateLabel;
    sections.push({
      sportKey: adapter.key,
      title: `${chrome.titlePrefix}${sectionLabel}`,
      url: chrome.url,
      color: chrome.color,
      lines: group.map((p) => p.display?.line ?? p.selection.label),
      count: group.length,
    });
  }
  return sections;
}

/** All positive-EV plays across every registered sport, freshest data first. */
async function collectPlays(dateEt: string): Promise<Play[]> {
  // Best-effort freshness (UFC pokes its gated odds poll); a failure must not
  // block the board. Registry-driven — no sport branch.
  await Promise.allSettled(SPORTS.map((a) => a.refresh?.(dateEt) ?? Promise.resolve()));
  const perSport = await Promise.all(
    SPORTS.map(async (a) => {
      try {
        return await a.listPlays(dateEt);
      } catch (err) {
        console.error(`listPlays failed for ${a.key} (board continues without it):`, err);
        return [] as Play[];
      }
    })
  );
  return perSport.flat();
}

/**
 * Turn board sections into Discord embeds. author + title + link land on each
 * section's FIRST embed, the compliance footer on its LAST, the section color on
 * every embed — reproducing the old MLB-green card + UFC-red Fight-Night embed
 * exactly, now from one branchless loop. The primary section is capped so a
 * non-primary section always has room within Discord's 10-embed limit.
 */
export function sectionsToEmbeds(sections: BoardSection[]): Record<string, unknown>[] {
  const embeds: Record<string, unknown>[] = [];
  for (const section of sections) {
    let chunks = packLines(section.lines);
    if (section.sportKey === SPORTS[0]?.key && chunks.length > MAX_PRIMARY_CHUNKS) {
      // No silent caps: a card this big (~360+ plays) means something's off upstream.
      console.warn(
        `postCard: ${chunks.length} ${section.sportKey} chunks exceeds ${MAX_PRIMARY_CHUNKS}; posting the first ${MAX_PRIMARY_CHUNKS}.`
      );
      chunks = chunks.slice(0, MAX_PRIMARY_CHUNKS);
    }
    chunks.forEach((desc, i, arr) => {
      embeds.push({
        ...(i === 0 ? { author: mosesAuthor(), title: section.title, url: section.url } : {}),
        description: desc,
        color: section.color,
        ...(i === arr.length - 1 ? { footer: { text: RESEARCH_FOOTER } } : {}),
      });
    });
  }
  return embeds.slice(0, MAX_EMBEDS);
}

/** The single funnel tease — the top play, primary sport first (its own free lean). */
export function freeLeanText(plays: Play[]): string | null {
  const primaryKey = SPORTS[0]?.key;
  const primaryTop = plays.find((p) => p.sportKey === primaryKey && p.display?.freeLean);
  const anyTop = plays.find((p) => p.display?.freeLean);
  return (primaryTop ?? anyTop)?.display?.freeLean ?? null;
}

/**
 * Persist the plays we just posted so #results can grade them (see postResults).
 * Upsert keyed on (postedForDate, playKey): a re-post of the same day leaves the
 * original row (and its grade) untouched. Sport-agnostic — `sport` is the play's
 * registry key, and grading dispatches on it via getAdapter(sport). Best-effort:
 * the caller swallows failures so a DB hiccup never blocks the Discord post.
 *
 * The MLB-only prop columns (mlbPlayerId/statCategory) are left null: only game
 * lines make the card (props carry no model EV), so they were already null on
 * every posted row, and post-Phase-3a the grader recovers a prop's inputs from
 * its playKey, not these columns.
 */
async function recordPlays(plays: Play[]): Promise<void> {
  await Promise.all(
    plays.map((p) =>
      prisma.postedPlay.upsert({
        where: { postedForDate_playKey: { postedForDate: p.postedForDate, playKey: p.playKey } },
        update: {},
        create: {
          postedForDate: p.postedForDate,
          playKey: p.playKey,
          sport: p.sportKey,
          matchId: p.eventRef,
          market: p.selection.market,
          kind: p.selection.kind,
          side: p.selection.side,
          point: p.selection.point,
          selectionLabel: p.selection.label,
          bestPrice: p.bestPrice,
          bestBookName: p.bestBookName,
          // The model EV we posted on — units derive from it, and #results grades
          // on units/price/result, not this field.
          ev: p.modelEv,
          units: p.suggestedUnits,
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
}

/**
 * Assemble the daily card EXACTLY as postDailyCardToDiscord would — same registry
 * sources, same sections, same formatters — but post nothing and record nothing.
 * The dry-run behind a "show me what it'd post" preview (and a test/debug hook),
 * so the card can be inspected before a webhook is ever wired.
 */
export async function previewDailyCard(dateEt: string = todayEt()): Promise<DailyCardPreview> {
  const label = prettyDate(dateEt);
  const plays = await collectPlays(dateEt);
  const sections = assembleSections(plays, label);
  const primary = sections.find((s) => s.sportKey === SPORTS[0]?.key);
  const ufc = sections.find((s) => s.sportKey === "ufc");
  return {
    label,
    premium: primary ? packLines(primary.lines).join("\n") : EMPTY_CARD,
    ufc: ufc ? ufc.lines.join("\n") : null,
    ufcTitle: ufc ? ufc.title : null,
    premiumCount: primary?.count ?? 0,
    ufcCount: ufc?.count ?? 0,
  };
}

export async function postWebhook(url: string, body: unknown): Promise<void> {
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

  const label = prettyDate(dateEt);
  const plays = await collectPlays(dateEt);
  const sections = assembleSections(plays, label);
  const premiumCount = sections.find((s) => s.sportKey === SPORTS[0]?.key)?.count ?? 0;
  const ufcCount = sections.find((s) => s.sportKey === "ufc")?.count ?? 0;

  await postWebhook(premiumUrl, {
    username: "Moses, Leader of Many",
    embeds: sectionsToEmbeds(sections),
  });

  // Record what we posted so #results can grade it. Best-effort: a DB failure
  // must not fail the post that already went out. Each play carries its own
  // postedForDate (UFC settles under its fight date, MLB under today's card).
  try {
    await recordPlays(plays);
  } catch (err) {
    console.error("recordPlays failed (card was still posted):", err);
  }

  // Free channel: a single lean as the funnel tease — selection only, no EV, no
  // best book. The value (the number + where to get it) stays behind the paywall.
  // Prefer the top primary-sport (MLB) play; on an MLB-dry day, tease the next
  // sport's top play so the funnel still fires when there's a card to sell.
  let freePosted = false;
  const freeUrl = process.env.DISCORD_FREE_WEBHOOK_URL;
  const lean = freeLeanText(plays);
  if (freeUrl && lean) {
    await postWebhook(freeUrl, {
      username: "Moses, Leader of Many",
      embeds: [
        {
          author: mosesAuthor(),
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

  return { posted: true, premiumCount, freePosted, ufcCount };
}
