import { prisma } from "@/lib/prisma";
import { fetchUfcEvents, type CitoBoutFighter, type CitoEvent } from "./citoApiClient";
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

async function upsertFighter(
  fighterCache: Map<string, string>,
  boutFighter: CitoBoutFighter,
  slug: string
): Promise<string> {
  const cached = fighterCache.get(slug);
  if (cached) return cached;

  const profile = boutFighter.profile;
  const record = profile?.record;

  const fighter = await prisma.ufcFighter.upsert({
    where: { citoSlug: slug },
    create: {
      citoSlug: slug,
      fullName: boutFighter.fighterName,
      nickname: profile?.nickname ?? null,
      division: profile?.division ?? null,
      recordWins: record?.wins ?? null,
      recordLosses: record?.losses ?? null,
      recordDraws: record?.draws ?? null,
      recordNoContest: record?.noContest ?? null,
    },
    update: {
      fullName: boutFighter.fighterName,
      nickname: profile?.nickname ?? null,
      division: profile?.division ?? null,
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

/**
 * Full historical UFC backfill: pages through every event (most-recent
 * first), embedding bouts + stats inline via includeBouts=true — confirmed
 * live that this covers the entire ~806-event dataset in ~81 calls,
 * comfortably under Cito's 500/month free-tier quota in a single run.
 * Idempotent throughout (upserts for Fighter/Event/Bout, createMany +
 * skipDuplicates for the immutable stat-row tables), so this doubles as the
 * ongoing sync mechanism for newly-completed events later — just re-run it.
 *
 * maxPages bounds a single invocation (mainly for local testing without
 * spending the full call budget); omit it for a real full backfill.
 */
export async function backfillUfcHistory(maxPages?: number): Promise<BackfillSummary> {
  const summary: BackfillSummary = {
    pagesProcessed: 0,
    eventsProcessed: 0,
    boutsProcessed: 0,
    boutFighterStatsWritten: 0,
    boutRoundStatsWritten: 0,
    skippedBouts: [],
  };

  const fighterCache = new Map<string, string>();
  let page = 1;

  while (true) {
    const { events, meta } = await fetchUfcEvents(page, true);
    summary.pagesProcessed++;

    for (const citoEvent of events) {
      const eventId = await upsertEvent(citoEvent);
      summary.eventsProcessed++;

      const boutFighterStatsRows: Prisma.UfcBoutFighterStatsCreateManyInput[] = [];
      const boutRoundStatsRows: Prisma.UfcBoutRoundStatsCreateManyInput[] = [];

      for (const citoBout of citoEvent.bouts ?? []) {
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
            resultRound: citoBout.resultRound,
            resultTime: citoBout.resultTime,
            statsFetchedAt: boutHasStats ? new Date() : null,
          },
          update: {
            status: citoBout.status,
            winnerFighterId,
            method: citoBout.method,
            methodDetails: citoBout.methodDetails,
            resultRound: citoBout.resultRound,
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

    if (!meta.hasNextPage || (maxPages !== undefined && summary.pagesProcessed >= maxPages)) {
      break;
    }
    page++;
  }

  return summary;
}
