import { cache } from "react";
import { prisma } from "@/lib/prisma";

/**
 * Read layer for the UFC UI. The fighter-math projection itself lives in
 * queries/ufcMatchup.ts (getUfcMatchup) + lib/ufc/fighterMath.ts; this file
 * covers the list/header shapes the pages render around it.
 *
 * Every list query filters `hasStats: true`. Per the schema's own caveat,
 * Cito mis-dates some events by exactly one year and every observed case has
 * hasStats=false, so hasStats is the practical trust signal for both the
 * event date AND whether the bout-level stats the style layer needs exist.
 * Surfacing only hasStats=true events keeps the list correctly ordered and
 * the projections well-fed.
 */

/** "W-L" (plus "-D" when non-zero) from a fighter's career record, or null if unknown. */
export function formatFighterRecord(
  wins: number | null,
  losses: number | null,
  draws: number | null
): string | null {
  if (wins === null || losses === null) return null;
  return draws && draws > 0 ? `${wins}-${losses}-${draws}` : `${wins}-${losses}`;
}

export interface UfcBoutCorner {
  id: string;
  name: string;
  record: string | null;
  imageUrl: string | null;
}

export interface UfcBoutSummary {
  id: string;
  weightClass: string;
  titleBout: boolean;
  cardSection: string | null;
  method: string | null;
  resultRound: number | null;
  red: UfcBoutCorner;
  blue: UfcBoutCorner;
  winnerFighterId: string | null;
}

export interface UfcEventSummary {
  id: string;
  title: string;
  eventDate: Date;
  location: string | null;
  bouts: UfcBoutSummary[];
}

function locationOf(city: string | null, country: string | null): string | null {
  // Cito's upcoming feed sometimes stores the same polluted string in BOTH
  // city and country (e.g. both "Las Vegas United States"), so dedupe to
  // avoid rendering it twice.
  const parts = [city, country].filter((p): p is string => Boolean(p));
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  return unique.join(", ") || null;
}

/** Sorted fighter-pair key — collapses the occasional duplicate Cito bout row (same two fighters listed twice per event, e.g. "Lightweight" and "Lightweight Bout"). */
function pairKey(redId: string, blueId: string): string {
  return [redId, blueId].sort().join(":");
}

/** Fighter columns the list/summary shape needs — shared by both event queries so their payloads map identically. */
const summaryFighterSelect = {
  id: true,
  fullName: true,
  imageUrl: true,
  recordWins: true,
  recordLosses: true,
  recordDraws: true,
} as const;

// Structural shapes for mapEventSummary — narrower than the Prisma payloads
// (which carry more columns), so both listRecent/listUpcoming results assign
// to them, keeping the mapper independent of the generator's type surface.
interface SummaryFighter {
  id: string;
  fullName: string;
  imageUrl: string | null;
  recordWins: number | null;
  recordLosses: number | null;
  recordDraws: number | null;
}
interface SummaryBout {
  id: string;
  weightClass: string;
  titleBout: boolean;
  cardSection: string | null;
  method: string | null;
  resultRound: number | null;
  winnerFighterId: string | null;
  redCornerFighterId: string;
  blueCornerFighterId: string;
  redCornerFighter: SummaryFighter;
  blueCornerFighter: SummaryFighter;
}
interface SummaryEvent {
  id: string;
  title: string;
  eventDate: Date;
  city: string | null;
  country: string | null;
  bouts: SummaryBout[];
}

/** Shared event → summary shaping (dedupe the occasional duplicate fighter-pair row; strip the "Bout" suffix; format records). */
function mapEventSummary(event: SummaryEvent): UfcEventSummary {
  const seen = new Set<string>();
  const bouts: UfcBoutSummary[] = [];
  for (const b of event.bouts) {
    const key = pairKey(b.redCornerFighterId, b.blueCornerFighterId);
    if (seen.has(key)) continue;
    seen.add(key);
    bouts.push({
      id: b.id,
      weightClass: b.weightClass.replace(/\s+Bout$/i, ""),
      titleBout: b.titleBout,
      cardSection: b.cardSection,
      method: b.method,
      resultRound: b.resultRound,
      winnerFighterId: b.winnerFighterId,
      red: {
        id: b.redCornerFighter.id,
        name: b.redCornerFighter.fullName,
        record: formatFighterRecord(b.redCornerFighter.recordWins, b.redCornerFighter.recordLosses, b.redCornerFighter.recordDraws),
        imageUrl: b.redCornerFighter.imageUrl,
      },
      blue: {
        id: b.blueCornerFighter.id,
        name: b.blueCornerFighter.fullName,
        record: formatFighterRecord(b.blueCornerFighter.recordWins, b.blueCornerFighter.recordLosses, b.blueCornerFighter.recordDraws),
        imageUrl: b.blueCornerFighter.imageUrl,
      },
    });
  }
  return {
    id: event.id,
    title: event.title,
    eventDate: event.eventDate,
    location: locationOf(event.city, event.country),
    bouts,
  };
}

/**
 * The most recent fully-ingested UFC events, newest first, each with its
 * bouts (deduped by fighter pair). Feeds the /ufc list page.
 */
export const listRecentUfcEvents = cache(async (limit = 12): Promise<UfcEventSummary[]> => {
  const events = await prisma.ufcEvent.findMany({
    where: { hasStats: true },
    orderBy: { eventDate: "desc" },
    take: limit,
    include: {
      bouts: {
        orderBy: { boutOrder: "asc" },
        include: {
          redCornerFighter: { select: summaryFighterSelect },
          blueCornerFighter: { select: summaryFighterSelect },
        },
      },
    },
  });

  return events.map(mapEventSummary);
});

/**
 * Upcoming/scheduled UFC cards, soonest first — the not-yet-fought fights
 * ingested from Cito's /events/upcoming feed (see backfillUpcomingUfcEvents).
 *
 * "Upcoming" is keyed off bout `status` (`confirmed`/`scheduled`), NOT the
 * event date: every historical bout in the DB is `completed`, including the
 * handful of Cito's +1yr mis-dated duplicate events (which are future-dated
 * but `hasStats=false` and `completed`), so filtering on non-completed bout
 * status is what cleanly separates real upcoming cards from that garbage. The
 * eventDate floor is a secondary guard so a stale scheduled event that never
 * got its results synced eventually drops off the list.
 */
export const listUpcomingUfcEvents = cache(async (limit = 8): Promise<UfcEventSummary[]> => {
  // Yesterday's UTC midnight — keeps a card visible through its fight night
  // while dropping genuinely-past scheduled events that were never updated.
  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - 1);

  const notCompleted = { status: { not: "completed" } } as const;

  const events = await prisma.ufcEvent.findMany({
    where: {
      eventDate: { gte: cutoff },
      bouts: { some: notCompleted },
    },
    orderBy: { eventDate: "asc" },
    take: limit,
    include: {
      bouts: {
        where: notCompleted,
        orderBy: { boutOrder: "asc" },
        include: {
          redCornerFighter: { select: summaryFighterSelect },
          blueCornerFighter: { select: summaryFighterSelect },
        },
      },
    },
  });

  return events.map(mapEventSummary);
});

export interface UfcFighterBio {
  id: string;
  name: string;
  nickname: string | null;
  division: string | null;
  record: string | null;
  imageUrl: string | null;
}

export interface UfcBoutHeader {
  boutId: string;
  eventTitle: string;
  eventDate: Date;
  location: string | null;
  weightClass: string;
  titleBout: boolean;
  status: string;
  method: string | null;
  methodDetails: string | null;
  resultRound: number | null;
  resultTime: string | null;
  winnerFighterId: string | null;
  red: UfcFighterBio;
  blue: UfcFighterBio;
}

function bioOf(f: {
  id: string;
  fullName: string;
  nickname: string | null;
  division: string | null;
  imageUrl: string | null;
  recordWins: number | null;
  recordLosses: number | null;
  recordDraws: number | null;
}): UfcFighterBio {
  return {
    id: f.id,
    name: f.fullName,
    nickname: f.nickname,
    division: f.division,
    record: formatFighterRecord(f.recordWins, f.recordLosses, f.recordDraws),
    imageUrl: f.imageUrl,
  };
}

/** Header/result/bio for one bout's detail page. Shares the request cache with getUfcMatchup's callers via React cache(). */
export const getUfcBoutHeader = cache(async (boutId: string): Promise<UfcBoutHeader | null> => {
  const bout = await prisma.ufcBout.findUnique({
    where: { id: boutId },
    include: {
      event: true,
      redCornerFighter: true,
      blueCornerFighter: true,
    },
  });
  if (!bout) return null;

  return {
    boutId: bout.id,
    eventTitle: bout.event.title,
    eventDate: bout.event.eventDate,
    location: locationOf(bout.event.city, bout.event.country),
    weightClass: bout.weightClass.replace(/\s+Bout$/i, ""),
    titleBout: bout.titleBout,
    status: bout.status,
    method: bout.method,
    methodDetails: bout.methodDetails,
    resultRound: bout.resultRound,
    resultTime: bout.resultTime,
    winnerFighterId: bout.winnerFighterId,
    red: bioOf(bout.redCornerFighter),
    blue: bioOf(bout.blueCornerFighter),
  };
});
