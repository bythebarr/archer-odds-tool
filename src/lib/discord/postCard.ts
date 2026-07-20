import { todayEt, etDateOf } from "@/lib/dateEt";
import { SITE_URL } from "@/lib/siteUrl";
import { prisma } from "@/lib/prisma";
import { unitsFor } from "@/lib/betting/kelly";
import { mosesAuthor } from "./brand";
import { SPORTS, type Play } from "@/lib/engine";
import { getSelection, splitBySelection, type PlayStream } from "@/lib/card/selection";

/**
 * Auto-post Archer's Best Plays to a paid Discord — the capper product, not a
 * line-shopping feed. The board is now assembled from the sport engine: every
 * registered adapter's `listPlays` returns normalized, pre-priced `Play`s already
 * rendered in that sport's capper voice (`display.line`), so this file just
 * groups by sport, renders sections, records, and teases — with no "is this MLB?"
 * branch. MLB carries the model (+EV) lens; UFC brings its fighter-math leans as
 * a second section. (sport-engine Phase 3 — the board wired to the registry.)
 *
 * Posts the curated Best Plays card → #todays-card (DISCORD_WEBHOOK_URL). That
 * is the room's ONLY play surface: there is no free lean and no second board.
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

/**
 * Section chrome derives entirely from the adapter's own `meta` — icon, label,
 * accent, href. There is no sport-keyed literal left in this file: MLB is not
 * special, UFC is not special, and a newly registered sport renders correctly
 * with zero changes here. That was the owner's explicit ask — the room is an
 * all-sports room, not a baseball room with UFC bolted on.
 */
function chromeFor(sportKey: string): { color: number; url: string; titlePrefix: string } {
  const meta = SPORTS.find((a) => a.key === sportKey)?.meta;
  if (!meta) return { color: ARCHR_GREEN, url: SITE_URL, titlePrefix: `${sportKey.toUpperCase()} · ` };
  return {
    color: hexToInt(meta.accent),
    url: `${SITE_URL}${meta.href}`,
    titlePrefix: `${meta.icon} ${meta.label} · `,
  };
}

/** "#3b82f6" → 0x3b82f6, the int form Discord embeds want. */
function hexToInt(hex: string): number {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return Number.isNaN(n) ? ARCHR_GREEN : n;
}

const KIND_TAG: Record<string, string> = { ml: "ML", spread: "SPR", total: "TOT", prop: "PROP" };

/**
 * The slate's line — deliberately NOT the card's voice. #ev-slate is a data
 * board: uniform across sports, both EV lenses side by side, and **no units**,
 * because nothing on the slate is staked or recorded. The card keeps each
 * sport's capper voice (`display.line`); this is the flat read of the same play.
 */
/**
 * Stamp the stake onto a card line. Units live here rather than in each sport's
 * renderer because the stake is the owner's call — set per play in the deck —
 * and `suggestedUnits` has already been replaced with his number by
 * splitBySelection. The slate never gets this: nothing there is staked.
 */
export function appendUnits(line: string, p: Play): string {
  const u = p.suggestedUnits;
  if (!u) return line;
  return `${line} · **${String(Number(u.toFixed(2)))}u**`;
}

export function slateLine(p: Play): string {
  const meta = SPORTS.find((a) => a.key === p.sportKey)?.meta;
  const tag = `${meta?.label.toUpperCase() ?? p.sportKey.toUpperCase()} ${KIND_TAG[p.selection.kind] ?? ""}`.trim();
  const price = p.bestPrice > 0 ? `+${p.bestPrice}` : `${p.bestPrice}`;
  const model = p.modelEv !== null ? `model ${formatPct(p.modelEv)}` : null;
  const market = p.marketEv !== null ? `market ${formatPct(p.marketEv)}` : null;
  const evs = [model, market].filter(Boolean).join(" · ");
  const start = ` · ${startStamp(p.startUtc)} ET`;
  return `\`${tag}\` **${p.selection.label}** ${price} · ${p.bestBookName}${evs ? ` · ${evs}` : ""}${start}`;
}

function formatPct(ev: number): string {
  return `${ev >= 0 ? "+" : ""}${(ev * 100).toFixed(1)}%`;
}

function startStamp(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
    .format(d)
    .replace(/\s?AM$/, "a")
    .replace(/\s?PM$/, "p");
}

export interface DiscordPostResult {
  posted: boolean;
  reason?: string;
  /** Handpicked plays posted to #todays-card (units, tracked). */
  cardCount?: number;
  /** Whether the single #free-play went out. */
  freePosted?: boolean;
  /** Unpicked plays posted to #ev-slate (no units, not recorded). */
  slateCount?: number;
  /** Selected plays whose line vanished before post time — skipped, not posted stale. */
  missingCount?: number;
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
 * Group plays into board sections, in registry order. **A sport with no plays
 * renders nothing** — there is no always-present primary section any more. That
 * single change is what stops a quiet baseball day from posting an empty MLB
 * card, and is why UFC simply isn't mentioned the six days a week it isn't on:
 * event-timed surfacing falls out of the data instead of a per-sport rule.
 *
 * `mode` picks the voice: the card uses each sport's pre-rendered capper line,
 * the slate uses the flat two-EV read.
 */
export function assembleSections(
  plays: Play[],
  dateLabel: string,
  mode: "card" | "slate" = "card"
): BoardSection[] {
  const byKey = new Map<string, Play[]>();
  for (const p of plays) {
    const arr = byKey.get(p.sportKey) ?? [];
    arr.push(p);
    byKey.set(p.sportKey, arr);
  }
  const sections: BoardSection[] = [];
  for (const adapter of SPORTS) {
    const group = byKey.get(adapter.key) ?? [];
    if (!group.length) continue;
    const chrome = chromeFor(adapter.key);
    const sectionLabel = group[0]?.display?.sectionLabel ?? dateLabel;
    sections.push({
      sportKey: adapter.key,
      title: `${chrome.titlePrefix}${sectionLabel}`,
      url: chrome.url,
      color: chrome.color,
      lines: group.map((p) =>
        mode === "slate" ? slateLine(p) : appendUnits(p.display?.line ?? p.selection.label, p)
      ),
      count: group.length,
    });
  }
  return sections;
}

/**
 * Keep only plays whose event actually happens on the card's ET date.
 *
 * GOVERNING RULE (owner, 2026-07-20): a sport is surfaced the day its event
 * runs — never before. Books don't load a card until game day, and a room that
 * talks about Saturday's UFC card every day from Wednesday reads as filler.
 *
 * Enforced HERE, once, rather than as a per-sport lookahead, because "how far
 * ahead do we tease?" is a property of the ROOM, not of any sport. UFC's adapter
 * still looks 3 days ahead for the app's own /ufc page; that's the app's
 * business, and this is the board's.
 *
 * ET, not UTC, is what makes this correct: a 10pm ET Saturday fight starts after
 * midnight UTC, so a UTC comparison would hold it back to "Sunday" and post it a
 * day late — the mirror image of the bug this fixes.
 */
export function onlyTodaysEvents(plays: Play[], dateEt: string): Play[] {
  return plays.filter((p) => etDateOf(p.startUtc) === dateEt);
}

/** All positive-EV plays across every registered sport, freshest data first. */
export async function collectPlays(dateEt: string): Promise<Play[]> {
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
  const all = perSport.flat();
  const todays = onlyTodaysEvents(all, dateEt);
  if (todays.length !== all.length) {
    // No silent filtering — say what was held back and why.
    const held = all.length - todays.length;
    const sports = [...new Set(all.filter((p) => !todays.includes(p)).map((p) => p.sportKey))];
    console.log(`postCard: holding ${held} play(s) whose event isn't today (${sports.join(", ")})`);
  }
  return todays;
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
    if (chunks.length > MAX_PRIMARY_CHUNKS) {
      // No silent caps: a section this big means something's off upstream.
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
async function recordPlays(plays: Play[], stream: PlayStream): Promise<void> {
  await Promise.all(
    plays.map((p) =>
      prisma.postedPlay.upsert({
        where: { postedForDate_playKey: { postedForDate: p.postedForDate, playKey: p.playKey } },
        update: {},
        create: {
          stream,
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

/**
 * The card's opening line — the "good morning, here's how today looks" note the
 * owner liked from the old morning drop, moved to where it belongs: on top of
 * the card itself, in the channel giving the picks, rather than a separate post
 * in a separate channel announcing that a post is coming.
 *
 * Sport-agnostic by construction — it names whichever sports are actually
 * playing, so it reads right on a five-sport Saturday and on a one-match Tuesday.
 */
export function cardIntro(card: Play[], slate: Play[], label: string): string {
  const listSports = (plays: Play[]) =>
    [...new Set(plays.map((p) => p.sportKey))]
      .map((k) => SPORTS.find((a) => a.key === k)?.meta)
      .filter((m): m is NonNullable<typeof m> => Boolean(m))
      .map((m) => `${m.icon} ${m.label}`)
      .join(" · ");

  if (!card.length) {
    // Nothing staked — here the SLATE's sports are the honest subject, because
    // what we looked at is the only thing there is to report.
    const looked = listSports(slate);
    return looked
      ? `**Good morning — ${label}.**\nWe priced ${looked} today. Nothing cleared the bar, so there's no card. No card is a card.`
      : `**Good morning — ${label}.**\nNothing on the board today.`;
  }

  // Sports on the CARD only. Listing the slate's sports here read as "we've got
  // plays across four sports" on a card that held two — overselling the day, on
  // the one post that has to be trustworthy.
  const sportList = listSports(card);
  const units = card.reduce((sum, p) => sum + p.suggestedUnits, 0);
  const first = card.reduce((a, b) => (a.startUtc < b.startUtc ? a : b));
  return (
    `**Good morning — ${label}.**\n` +
    `${card.length} play${card.length === 1 ? "" : "s"} on the card` +
    `${sportList ? ` · ${sportList}` : ""} · ${units.toFixed(2).replace(/\.?0+$/, "")}u total` +
    ` · first one starts ${startStamp(first.startUtc)} ET. Let's eat. 🏹`
  );
}

export interface PreviewSection {
  title: string;
  body: string;
  /** Section accent as a CSS hex string, for the preview's left border. */
  accent: string;
}

export interface DailyCardPreview {
  label: string;
  /** The card's opening welcome line, exactly as it would post. */
  intro: string;
  /** #todays-card sections — his handpicks, with units. Empty = "no card is a card". */
  card: PreviewSection[];
  /** The single #free-play line, or null when he hasn't picked one. */
  free: string | null;
  /** #ev-slate sections — everything unpicked, no units. */
  slate: PreviewSection[];
  cardCount: number;
  slateCount: number;
  missingCount: number;
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
  const selection = await getSelection(dateEt);
  const { card, free, slate, missing } = splitBySelection(plays, selection);

  const toPreview = (s: BoardSection): PreviewSection => ({
    title: s.title,
    body: s.lines.join("\n"),
    accent: `#${s.color.toString(16).padStart(6, "0")}`,
  });

  return {
    label,
    intro: cardIntro(card, slate, label),
    card: assembleSections(card, label, "card").map(toPreview),
    free: free ? free.display?.line ?? slateLine(free) : null,
    slate: assembleSections(slate, label, "slate").map(toPreview),
    cardCount: card.length,
    slateCount: slate.length,
    missingCount: missing.length,
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

/**
 * The daily drop — three posts, from one pull of the board and one read of the
 * owner's deck picks (see @/lib/card/selection):
 *
 *   👑 #todays-card — his handpicks, with units. Recorded as `card`.
 *   🎯 #free-play   — the single free play, with units. Recorded as `free`.
 *   📊 #ev-slate    — everything he didn't pick. No units. NOT recorded.
 *
 * Each channel is independently dormant: an unset webhook skips that post and
 * the others still go. The card's webhook is the one required env — with it
 * unset nothing runs at all, preserving the "shippable while inert" posture.
 *
 * Ordering matters: the card posts BEFORE the slate. If the slate went first,
 * premium members would see the full board and could infer the card from what
 * was withheld.
 */
export async function postDailyCardToDiscord(
  dateEt: string = todayEt(),
  /** Pre-pulled board, so the scheduling tick doesn't collect it a second time. */
  prefetched?: Play[]
): Promise<DiscordPostResult> {
  const cardUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!cardUrl) return { posted: false, reason: "dormant: DISCORD_WEBHOOK_URL not set" };

  const label = prettyDate(dateEt);
  const plays = prefetched ?? (await collectPlays(dateEt));
  const selection = await getSelection(dateEt);
  const { card, free, slate, missing } = splitBySelection(plays, selection);

  if (missing.length) {
    console.warn(`postCard: ${missing.length} selected play(s) no longer live, skipping:`, missing);
  }

  // 👑 The card, led by the daily welcome. Posts even when empty — "no card is
  // a card" is a real signal, and silence would read as a broken bot.
  const cardSections = assembleSections(card, label, "card");
  const cardEmbeds = cardSections.length
    ? sectionsToEmbeds(cardSections)
    : [
        {
          author: mosesAuthor(),
          title: `👑 Today's Card · ${label}`,
          description: EMPTY_CARD,
          color: ARCHR_GREEN,
          footer: { text: RESEARCH_FOOTER },
        },
      ];
  await postWebhook(cardUrl, {
    username: "Moses, Leader of Many",
    content: cardIntro(card, slate, label),
    embeds: cardEmbeds,
  });

  // 🎯 The free play — selection + number, same as premium sees it. It carries
  // units because it rides its own tracked record.
  let freePosted = false;
  const freeUrl = process.env.DISCORD_FREE_WEBHOOK_URL;
  if (freeUrl && free) {
    await postWebhook(freeUrl, {
      username: "Moses, Leader of Many",
      embeds: [
        {
          author: mosesAuthor(),
          title: `🎯 Free Play · ${label}`,
          description: `${free.display?.line ?? slateLine(free)}\n\nTracked in #results on its own record — wins and losses.`,
          color: ARCHR_GREEN,
          footer: { text: RESEARCH_FOOTER },
        },
      ],
    });
    freePosted = true;
  }

  // 📊 The slate — the firehose, no units, never recorded.
  const slateUrl = process.env.DISCORD_SLATE_WEBHOOK_URL;
  if (slateUrl && slate.length) {
    const slateSections = assembleSections(slate, label, "slate");
    const embeds = sectionsToEmbeds(slateSections);
    if (embeds.length) {
      embeds[0] = { ...embeds[0], title: `📊 Full +EV Slate · ${label}` };
      embeds[embeds.length - 1] = {
        ...embeds[embeds.length - 1],
        footer: { text: `No units — information only. Today's staked card is in #todays-card. ${RESEARCH_FOOTER}` },
      };
    }
    await postWebhook(slateUrl, { username: "Moses, Leader of Many", embeds });
  }

  // Record ONLY what carries units. The slate is deliberately absent from the
  // ledger — nothing unstaked may ever move a record. Best-effort: a DB failure
  // must not fail posts that already went out.
  try {
    await recordPlays(card, "card");
    if (free) await recordPlays([free], "free");
  } catch (err) {
    console.error("recordPlays failed (posts still went out):", err);
  }

  return {
    posted: true,
    cardCount: card.length,
    freePosted,
    slateCount: slate.length,
    missingCount: missing.length,
  };
}
