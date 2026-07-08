import { prisma } from "@/lib/prisma";
import { recordPollLog } from "@/lib/pollingPolicy";
import { fetchUfcEvents, fetchUpcomingUfcEvents, type CitoBoutFighter, type CitoEvent } from "./citoApiClient";
import { parseStatLine } from "./citoStats";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Cito returns full results-only data (no stats) even for events it hasn't
 * enriched yet — see the schema's caveat comment on UfcEvent.hasStats.
 * Bout-level stats (createMany batches below) are only ever written when
 * the bout itself reports hasStats, regardless of the event-level flag,
 * since even a hasStats=true event can have unenriched early-card bouts
 * (confirmed live: one Fight Night had 26 bouts, only 13 with stats).
 */

/**
 * fighterSlug is occasionally null in Cito's bout-fighter payload (confirmed
 * live, e.g. a "Josh Culibao" entry) even though it's typed as required —
 * falls back to the embedded profile's own slug, and returns null only if
 * neither is present, so the caller can skip that bout rather than upsert a
 * fighter with no stable identifier (would risk creating duplicate rows for
 * the same real person across different appearances).
 */
function resolveFighterSlug(boutFighter: CitoBoutFighter): string | null {
  return boutFighter.fighterSlug ?? boutFighter.profile?.slug ?? null;
}

/**
 * Prefer the profile's face-focused headshot for a round avatar; fall back to
 * the bout-level standing-body cutout, then the profile's own imageUrl.
 * Returns null when Cito has no photo for this appearance (older fighters).
 */
function resolveFighterImageUrl(boutFighter: CitoBoutFighter): string | null {
  const profile = boutFighter.profile;
  return profile?.headshotUrl ?? boutFighter.imageUrl ?? profile?.imageUrl ?? null;
}

async function upsertFighter(
  fighterCache: Map<string, string>,
  boutFighter: CitoBoutFighter,
  slug: string
): Promise<string> {
  const cached = fighterCache.get(slug);
  if (cached) return cached;

  const profile = boutFighter.profile;
  const record = profile?.record;
  const imageUrl = resolveFighterImageUrl(boutFighter);

  const fighter = await prisma.ufcFighter.upsert({
    where: { citoSlug: slug },
    create: {
      citoSlug: slug,
      fullName: boutFighter.fighterName,
      nickname: profile?.nickname ?? null,
      division: profile?.division ?? null,
      imageUrl,
      recordWins: record?.wins ?? null,
      recordLosses: record?.losses ?? null,
      recordDraws: record?.draws ?? null,
      recordNoContest: record?.noContest ?? null,
    },
    update: {
      fullName: boutFighter.fighterName,
      nickname: profile?.nickname ?? null,
      division: profile?.division ?? null,
      // Only overwrite when this appearance actually has a photo, so a later
      // photo-less bout can't wipe a headshot captured from an earlier one.
      ...(imageUrl ? { imageUrl } : {}),
      recordWins: record?.wins ?? null,
      recordLosses: record?.losses ?? null,
      recordDraws: record?.draws ?? null,
      recordNoContest: record?.noContest ?? null,
    },
  });

  fighterCache.set(slug, fighter.id);
  return fighter.id;
}

async function upsertEvent(citoEvent: CitoEvent): Promise<string> {
  const event = await prisma.ufcEvent.upsert({
    where: { citoEventId: citoEvent.id },
    create: {
      citoEventId: citoEvent.id,
      citoSlug: citoEvent.slug,
      title: citoEvent.title,
      eventDate: new Date(citoEvent.eventDate),
      venue: citoEvent.venue,
      city: citoEvent.city,
      country: citoEvent.country,
      hasStats: citoEvent.hasStats,
    },
    update: {
      title: citoEvent.title,
      eventDate: new Date(citoEvent.eventDate),
      venue: citoEvent.venue,
      city: citoEvent.city,
      country: citoEvent.country,
      hasStats: citoEvent.hasStats,
    },
  });
  return event.id;
}

export interface BackfillSummary {
  pagesProcessed: number;
  eventsProcessed: number;
  boutsProcessed: number;
  boutFighterStatsWritten: number;
  boutRoundStatsWritten: number;
  skippedBouts: string[]; // bouts missing red/blue corner data — logged, not thrown on
}

function emptySummary(): BackfillSummary {
  return {
    pagesProcessed: 0,
    eventsProcessed: 0,
    boutsProcessed: 0,
    boutFighterStatsWritten: 0,
    boutRoundStatsWritten: 0,
    skippedBouts: [],
  };
}

/**
 * Ingest a single Cito event (its bouts, fighters, and any stats) into the
 * DB, mutating `summary` with the counts. Shared by both the historical
 * (`/events/recent`) sweep and the upcoming (`/events/upcoming`) sweep since
 * the two feeds return an identical event shape — an upcoming event simply
 * has no winner/method/stats yet and its bouts carry `status=confirmed`
 * rather than `completed`, all of which flow through the same upserts
 * unchanged. Cancelled bouts are skipped defensively (the upcoming feed
 * already omits them, but the guard keeps a stray one out of the DB).
 */
async function ingestEvent(
  citoEvent: CitoEvent,
  fighterCache: Map<string, string>,
  summary: BackfillSummary
): Promise<void> {
  const eventId = await upsertEvent(citoEvent);
  summary.eventsProcessed++;

  const boutFighterStatsRows: Prisma.UfcBoutFighterStatsCreateManyInput[] = [];
  const boutRoundStatsRows: Prisma.UfcBoutRoundStatsCreateManyInput[] = [];

  for (const citoBout of citoEvent.bouts ?? []) {
    if (citoBout.isCancelled) continue;

    const redCorner = citoBout.fighters.find((f) => f.corner === "red");
    const blueCorner = citoBout.fighters.find((f) => f.corner === "blue");
    const redSlug = redCorner ? resolveFighterSlug(redCorner) : null;
    const blueSlug = blueCorner ? resolveFighterSlug(blueCorner) : null;
    if (!redCorner || !blueCorner || !redSlug || !blueSlug) {
      summary.skippedBouts.push(citoBout.id);
      continue;
    }

    const redFighterId = await upsertFighter(fighterCache, redCorner, redSlug);
    const blueFighterId = await upsertFighter(fighterCache, blueCorner, blueSlug);

    const winnerFighterId =
      citoBout.winnerFighterSlug === redSlug
        ? redFighterId
        : citoBout.winnerFighterSlug === blueSlug
          ? blueFighterId
          : null;

    const boutHasStats = Boolean(citoBout.boutStats && citoBout.boutStats.length > 0);
    // Upcoming bouts report resultRound=0 (no result yet); normalise to null
    // so nothing downstream ever renders a phantom "R0". Completed bouts
    // always have a real round >= 1, so this is a no-op for them.
    const resultRound = citoBout.resultRound || null;

    const bout = await prisma.ufcBout.upsert({
      where: { citoBoutId: citoBout.id },
      create: {
        citoBoutId: citoBout.id,
        eventId,
        weightClass: citoBout.weightClass,
        titleBout: citoBout.titleBout,
        cardSection: citoBout.cardSection,
        boutOrder: citoBout.boutOrder,
        redCornerFighterId: redFighterId,
        blueCornerFighterId: blueFighterId,
        status: citoBout.status,
        winnerFighterId,
        method: citoBout.method,
        methodDetails: citoBout.methodDetails,
        resultRound,
        resultTime: citoBout.resultTime,
        statsFetchedAt: boutHasStats ? new Date() : null,
      },
      update: {
        status: citoBout.status,
        winnerFighterId,
        method: citoBout.method,
        methodDetails: citoBout.methodDetails,
        resultRound,
        resultTime: citoBout.resultTime,
        ...(boutHasStats ? { statsFetchedAt: new Date() } : {}),
      },
    });
    summary.boutsProcessed++;

    for (const statLine of citoBout.boutStats ?? []) {
      const fighterId = statLine.fighterSlug === redSlug ? redFighterId : blueFighterId;
      boutFighterStatsRows.push({ boutId: bout.id, fighterId, ...parseStatLine(statLine) });
    }
    for (const statLine of citoBout.roundStats ?? []) {
      const fighterId = statLine.fighterSlug === redSlug ? redFighterId : blueFighterId;
      boutRoundStatsRows.push({
        boutId: bout.id,
        fighterId,
        round: statLine.round ?? 0,
        ...parseStatLine(statLine),
      });
    }
  }

  if (boutFighterStatsRows.length > 0) {
    const result = await prisma.ufcBoutFighterStats.createMany({
      data: boutFighterStatsRows,
      skipDuplicates: true,
    });
    summary.boutFighterStatsWritten += result.count;
  }
  if (boutRoundStatsRows.length > 0) {
    const result = await prisma.ufcBoutRoundStats.createMany({
      data: boutRoundStatsRows,
      skipDuplicates: true,
    });
    summary.boutRoundStatsWritten += result.count;
  }
}

/**
 * True once an event is fully ingested AND immutable: it already exists in
 * the DB with hasStats=true and the incoming copy is still hasStats=true, so
 * nothing about it can have changed. Because `/events/recent` is ordered
 * newest-first, the first such event means every older event is likewise
 * settled — the signal the incremental sync uses to stop paging. Returns
 * false for not-yet-enriched events (hasStats=false — freshly-fought events
 * still being scored, plus Cito's +1yr mis-dated dup garbage), so those keep
 * getting re-synced until they settle.
 */
async function isEventAlreadySettled(citoEvent: CitoEvent): Promise<boolean> {
  if (!citoEvent.hasStats) return false;
  const existing = await prisma.ufcEvent.findUnique({
    where: { citoEventId: citoEvent.id },
    select: { hasStats: true },
  });
  return existing?.hasStats === true;
}

interface SweepOptions {
  /** First page to fetch (1-based). Defaults to 1. Lets a chunked seed resume mid-history. */
  startPage?: number;
  /** Hard cap on pages fetched in one run (Cito call budget). */
  maxPages?: number;
  /** Stop as soon as an already-settled event is reached (incremental daily sync). */
  stopWhenSettled?: boolean;
}

interface SweepResult {
  /** True if the final page of history was consumed (no more pages beyond). */
  reachedEnd: boolean;
  /** The last page number actually fetched this run. */
  lastPage: number;
}

/**
 * Shared paging loop over `/events/recent` (newest-first), ingesting each
 * event via ingestEvent. `stopWhenSettled` turns it into an incremental sync
 * that halts at the first immutable already-ingested event; `startPage`/
 * `maxPages` let a chunked seed cover the history a slice at a time. Mutates
 * the caller-owned summary; returns where paging ended so a caller can resume.
 */
async function sweepRecentEvents(
  fighterCache: Map<string, string>,
  summary: BackfillSummary,
  opts: SweepOptions
): Promise<SweepResult> {
  let page = opts.startPage ?? 1;

  while (true) {
    const { events, meta } = await fetchUfcEvents(page, true);
    summary.pagesProcessed++;

    for (const citoEvent of events) {
      if (opts.stopWhenSettled && (await isEventAlreadySettled(citoEvent))) {
        // Reached immutable, fully-ingested history — everything older is settled too.
        return { reachedEnd: true, lastPage: page };
      }
      await ingestEvent(citoEvent, fighterCache, summary);
    }

    if (!meta.hasNextPage) {
      return { reachedEnd: true, lastPage: page };
    }
    if (opts.maxPages !== undefined && summary.pagesProcessed >= opts.maxPages) {
      return { reachedEnd: false, lastPage: page };
    }
    page++;
  }
}

/**
 * Full historical UFC backfill: pages through every event (most-recent
 * first), embedding bouts + stats inline via includeBouts=true — confirmed
 * live that this covers the entire ~806-event dataset in ~81 calls. Idempotent
 * throughout (upserts for Fighter/Event/Bout, createMany + skipDuplicates for
 * the immutable stat-row tables). Use this for the initial catch-up or a
 * manual full re-sync; the DAILY cron uses syncRecentUfcEvents instead.
 *
 * maxPages bounds a single invocation (mainly for local testing without
 * spending the full call budget); omit it for a real full backfill.
 */
export async function backfillUfcHistory(maxPages?: number): Promise<BackfillSummary> {
  const summary = emptySummary();
  const fighterCache = new Map<string, string>();
  await sweepRecentEvents(fighterCache, summary, { maxPages });
  return summary;
}

// Safety backstop for the incremental sync: even if the settled-event signal
// somehow never fires, never fetch more than this many pages in a daily run.
// The natural stop is ~3-4 pages (past Cito's ~27 mis-dated dups + the latest
// real events), so this only ever bounds a pathological case.
const DAILY_SYNC_MAX_PAGES = 10;

/**
 * Incremental daily UFC sync — the cheap replacement for re-sweeping all ~806
 * events (~81 calls) every day, which blew Cito's 500/month free tier
 * (~2,400/month). Pages `/events/recent` newest-first and stops at the first
 * already-settled event (see isEventAlreadySettled), so it only re-fetches the
 * handful of events that could have changed since yesterday: brand-new cards,
 * freshly-fought events still being enriched, and the not-yet-deduped +1yr
 * mis-dated dup garbage near the top. Typically ~3-4 calls; hard-capped at
 * DAILY_SYNC_MAX_PAGES. A late enrichment of a very old event would be missed
 * (it sits below the stop point) — rerun backfillUfcHistory() manually for
 * that rare case.
 */
export async function syncRecentUfcEvents(): Promise<BackfillSummary> {
  const summary = emptySummary();
  const fighterCache = new Map<string, string>();
  await sweepRecentEvents(fighterCache, summary, {
    stopWhenSettled: true,
    maxPages: DAILY_SYNC_MAX_PAGES,
  });
  return summary;
}

/**
 * Ingest Cito's upcoming/scheduled cards (`/events/upcoming`) so genuinely
 * not-yet-fought fights land in the DB alongside history — the piece the
 * historical `/events/recent` sweep can't cover. Shares ingestEvent with the
 * historical backfill, so upcoming bouts arrive with `status=confirmed` and
 * no result/stats, which the read layer keys off to tell "upcoming" apart
 * from completed fights (see listUpcomingUfcEvents). Cheap (a single page of
 * ~8 events as of writing), so this runs every day next to the history sync.
 * Idempotent: once an upcoming event is fought, the historical sweep re-upserts
 * the same bouts with `status=completed` and real results.
 */
export async function backfillUpcomingUfcEvents(): Promise<BackfillSummary> {
  const summary = emptySummary();
  const fighterCache = new Map<string, string>();
  let page = 1;

  while (true) {
    const { events, meta } = await fetchUpcomingUfcEvents(page, true);
    summary.pagesProcessed++;

    for (const citoEvent of events) {
      await ingestEvent(citoEvent, fighterCache, summary);
    }

    if (!meta.hasNextPage) break;
    page++;
  }

  return summary;
}
