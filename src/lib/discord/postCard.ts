import { todayEt, etDateOf } from "@/lib/dateEt";
import { SITE_URL } from "@/lib/siteUrl";
import { prisma } from "@/lib/prisma";
import { unitsFor } from "@/lib/betting/kelly";
import { mosesAuthor, ARCHR_GREEN, RESEARCH_FOOTER, KIND_TAG, prettyDate } from "./brand";
import { postEmbeds } from "./webhook";
import { markPosted } from "./postMarker";
import { recordPollLog } from "@/lib/pollingPolicy";
import { SPORTS, stakeable, type Play } from "@/lib/engine";
import { getReportedVerdicts } from "@/lib/queries/modelTrust";
import { getSelection, splitBySelection, type PlayStream } from "@/lib/card/selection";

/**
 * Auto-post Archer's Best Plays to a paid Discord — the capper product, not a
 * line-shopping feed. The board is now assembled from the sport engine: every
 * registered adapter's `listPlays` returns normalized, pre-priced `Play`s already
 * rendered in that sport's capper voice (`display.line`), so this file just
 * groups by sport, renders sections, records, and teases — with no "is this MLB?"
 * branch: each sport with plays gets its own section, in registry order.
 *
 * Three posts a day (see postDailyCardToDiscord): the handpicked card
 * (DISCORD_WEBHOOK_URL), the one free play (DISCORD_FREE_WEBHOOK_URL), and the
 * unstaked slate (DISCORD_SLATE_WEBHOOK_URL).
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
export { postWebhook } from "./webhook";

/**
 * The premium card posts EVERY positive-Archer-EV play — no edge floor, no
 * ceiling, no count cap (product decision: paid members get the full model
 * board, they judge for themselves). Conviction shows in the STAKE, not a
 * filter: each adapter sizes every play by Kelly (edge × odds), hard-capped by
 * price so long-priced dogs never get fat (see @/lib/betting/kelly).
 */
/** Most embeds one sport's section may take (each up to 4,000 chars); past it, a warning and a cut. */
const MAX_SECTION_CHUNKS = 9;

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

/**
 * The slate's line — deliberately NOT the card's voice. #ev-slate is a data
 * board: uniform across sports, both EV lenses side by side, and **no units**,
 * because nothing on the slate is staked or recorded. The card keeps each
 * sport's capper voice (`display.line`); this is the flat read of the same play.
 */
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
  /** Selected plays from an untrusted model — posted on the slate, unstaked, not recorded. */
  heldCount?: number;
  /** What failed after the card went out (free play, slate, recording). The card itself posted. */
  errors?: string[];
}

const EMPTY_CARD =
  "_No plays cleared ARCHR Edge today. No card is a card — we don't force action._";

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

/**
 * Drop plays from sports we can price but can't settle (`meta.signalOnly`).
 *
 * Not a taste call about which sports "deserve" the card — the owner's rule is
 * post EVERY edge. It's that a signal-only sport has no results feed at all, so
 * its plays would be posted, recorded, and then never graded: the room sees a
 * pick and never sees how it went, and the tracked record carries rows that can
 * only ever read "pending". Silence about the outcome is worse than not posting.
 *
 * The sport keeps its own page and its model keeps running — this filter governs
 * the tracked play surface only. Clearing `signalOnly` (i.e. wiring a results
 * source) puts the sport back on the card with no change here.
 */
export function excludeSignalOnly(plays: Play[]): Play[] {
  const signalOnly = new Set(SPORTS.filter((a) => a.meta.signalOnly).map((a) => a.key));
  return plays.filter((p) => !signalOnly.has(p.sportKey));
}

/** All positive-EV plays across every registered sport, freshest data first. */
export async function collectPlays(dateEt: string): Promise<Play[]> {
  // Best-effort freshness (UFC pokes its gated odds poll); a failure must not
  // block the board. Registry-driven — no sport branch.
  // Parked sports sit out the card (see SportMeta.parked); their past plays still grade.
  const lineup = SPORTS.filter((a) => !a.meta.parked);
  await Promise.allSettled(lineup.map((a) => a.refresh?.(dateEt) ?? Promise.resolve()));
  const perSport = await Promise.all(
    lineup.map(async (a) => {
      try {
        return await a.listPlays(dateEt);
      } catch (err) {
        console.error(`listPlays failed for ${a.key} (board continues without it):`, err);
        // Logged where /api/status shows it, so a sport missing from the card isn't silent.
        const message = err instanceof Error ? err.message : String(err);
        await recordPollLog(`board:${a.key}`, `error: ${message.slice(0, 300)}`).catch(() => {});
        return [] as Play[];
      }
    })
  );
  const all = excludeSignalOnly(perSport.flat());
  const ungradable = perSport.flat().length - all.length;
  if (ungradable) {
    // No silent filtering — say what was held back and why.
    console.log(`postCard: holding ${ungradable} play(s) from signal-only sports (no results source to grade them)`);
  }
  const todays = onlyTodaysEvents(all, dateEt);
  if (todays.length !== all.length) {
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
 * exactly, now from one branchless loop. There's no per-message cap here:
 * postEmbeds splits the result into as many messages as Discord's limits need.
 */
export function sectionsToEmbeds(sections: BoardSection[]): Record<string, unknown>[] {
  const embeds: Record<string, unknown>[] = [];
  for (const section of sections) {
    let chunks = packLines(section.lines);
    if (chunks.length > MAX_SECTION_CHUNKS) {
      // No silent caps: a section this big means something's off upstream.
      console.warn(
        `postCard: ${chunks.length} ${section.sportKey} chunks exceeds ${MAX_SECTION_CHUNKS}; posting the first ${MAX_SECTION_CHUNKS}.`
      );
      chunks = chunks.slice(0, MAX_SECTION_CHUNKS);
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
  return embeds;
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
  heldCount: number;
}

/**
 * Split the board for posting, behind the model-trust gate: a pick whose model
 * isn't trusted on /models (lib/engine/trust.ts) goes to the unstaked slate,
 * never the card or the free play, and is logged.
 */
export async function splitForPosting(plays: Play[], dateEt: string) {
  const [selection, verdicts] = await Promise.all([getSelection(dateEt), getReportedVerdicts()]);
  const split = splitBySelection(plays, selection, (p) => stakeable(p, verdicts));
  if (split.held.length) {
    console.log(
      `postCard: ${split.held.length} pick(s) from untrusted models posting unstaked on the slate:`,
      split.held.map((p) => `${p.sportKey} ${p.selection.label}`)
    );
  }
  return split;
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
  const { card, free, slate, missing, held } = await splitForPosting(plays, dateEt);

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
    heldCount: held.length,
  };
}

/** The #🎁-free-play post: the play's line, same as premium sees it, on its own record. */
export function freePlayEmbed(free: Play, label: string): Record<string, unknown> {
  return {
    author: mosesAuthor(),
    title: `🎯 Free Play · ${label}`,
    description: `${free.display?.line ?? slateLine(free)}\n\nTracked in #📊-the-ledger on its own record — wins and losses.`,
    color: ARCHR_GREEN,
    footer: { text: RESEARCH_FOOTER },
  };
}

/** The #📈-the-firehose post: the flat two-EV read of every unstaked play, no units. */
export function slateEmbeds(slate: Play[], label: string): Record<string, unknown>[] {
  const embeds = sectionsToEmbeds(assembleSections(slate, label, "slate"));
  if (embeds.length) {
    embeds[0] = { ...embeds[0], title: `📊 Full +EV Slate · ${label}` };
    embeds[embeds.length - 1] = {
      ...embeds[embeds.length - 1],
      footer: { text: `No units — information only. Today's staked card is in #👑-todays-card. ${RESEARCH_FOOTER}` },
    };
  }
  return embeds;
}

/** The steps of the daily drop, as runDrop orders them. A null post is a dormant channel. */
export interface DropSteps {
  postCard: () => Promise<void>;
  markPosted: () => Promise<void>;
  recordCard: () => Promise<void>;
  postFree: (() => Promise<void>) | null;
  recordFree: () => Promise<void>;
  postSlate: (() => Promise<void>) | null;
}

/**
 * Run the drop in the order that keeps a failure cheap (see
 * postDailyCardToDiscord). A card failure throws before anything else runs;
 * every later failure is caught, logged and returned, and the rest still runs.
 */
export async function runDrop(steps: DropSteps): Promise<{ freePosted: boolean; slatePosted: boolean; errors: string[] }> {
  await steps.postCard();

  const errors: string[] = [];
  const attempt = async (what: string, step: () => Promise<void>): Promise<boolean> => {
    try {
      await step();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`postCard: ${what} failed (the card already went out):`, err);
      errors.push(`${what}: ${message.slice(0, 300)}`);
      return false;
    }
  };

  // The card is out: mark and record it before anything else can fail.
  await attempt("marking the day posted", steps.markPosted);
  await attempt("recording the card", steps.recordCard);

  // The free play rides its own record, so it's recorded only once it has posted.
  const freePosted = steps.postFree ? await attempt("the free play post", steps.postFree) : false;
  if (freePosted) await attempt("recording the free play", steps.recordFree);

  // The slate: no units, never recorded.
  const slatePosted = steps.postSlate ? await attempt("the slate post", steps.postSlate) : false;

  return { freePosted, slatePosted, errors };
}

/**
 * The daily drop — three posts, from one pull of the board and one read of the
 * owner's deck picks (see @/lib/card/selection):
 *
 *   👑 #👑-todays-card — his handpicks, with units. Recorded as `card`.
 *   🎯 #🎁-free-play   — the single free play, with units. Recorded as `free`.
 *   📊 #📈-the-firehose — everything else (including picks the trust gate
 *                         held back). No units. NOT recorded.
 *
 * Each channel is independently dormant: an unset webhook skips that post and
 * the others still go. The card's webhook is the one required env — with it
 * unset nothing runs at all, preserving the "shippable while inert" posture.
 *
 * Order, and what a failure costs:
 *   1. The card posts first. If it fails, this throws, nothing is recorded or
 *      marked, and the next tick retries the whole drop.
 *   2. Once it's out, the day is marked posted and the card is recorded, before
 *      anything else can fail. A later failure can't re-post the card or leave
 *      it off the record.
 *   3. The free play and the slate each post on their own. A failure is logged
 *      and returned in `errors`, and the other still goes. The free play is
 *      recorded only if it actually posted.
 * The card goes before the slate so premium members can't infer the card from
 * what the full board withheld.
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
  const { card, free, slate, missing, held } = await splitForPosting(plays, dateEt);

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
  const freeUrl = process.env.DISCORD_FREE_WEBHOOK_URL;
  const slateUrl = process.env.DISCORD_SLATE_WEBHOOK_URL;
  if (free && !freeUrl) {
    console.warn("postCard: a free play is picked but DISCORD_FREE_WEBHOOK_URL is unset; not posted or recorded");
  }
  const { freePosted, slatePosted, errors } = await runDrop({
    postCard: () => postEmbeds(cardUrl, cardEmbeds, cardIntro(card, slate, label)),
    markPosted: () => markPosted("post-card", dateEt),
    recordCard: () => recordPlays(card, "card"),
    postFree: freeUrl && free ? () => postEmbeds(freeUrl, [freePlayEmbed(free, label)]) : null,
    recordFree: () => (free ? recordPlays([free], "free") : Promise.resolve()),
    postSlate: slateUrl && slate.length ? () => postEmbeds(slateUrl, slateEmbeds(slate, label)) : null,
  });

  // Where /api/status can see it: the day's drop, and anything that failed after the card.
  await recordPollLog("discord:post-card", errors.length ? `partial: ${errors.join("; ")}`.slice(0, 900) : `ok ${dateEt}`).catch(
    (err) => console.error("postCard: couldn't log the post outcome:", err)
  );

  return {
    posted: true,
    cardCount: card.length,
    freePosted,
    slateCount: slatePosted ? slate.length : 0,
    missingCount: missing.length,
    heldCount: held.length,
    ...(errors.length ? { errors } : {}),
  };
}
