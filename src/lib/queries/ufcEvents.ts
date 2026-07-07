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
  return [city, country].filter(Boolean).join(", ") || null;
}

/** Sorted fighter-pair key — collapses the occasional duplicate Cito bout row (same two fighters listed twice per event, e.g. "Lightweight" and "Lightweight Bout"). */
function pairKey(redId: string, blueId: string): string {
  return [redId, blueId].sort().join(":");
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
          redCornerFighter: { select: { id: true, fullName: true, recordWins: true, recordLosses: true, recordDraws: true } },
          blueCornerFighter: { select: { id: true, fullName: true, recordWins: true, recordLosses: true, recordDraws: true } },
        },
      },
    },
  });

  return events.map((event) => {
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
        },
        blue: {
          id: b.blueCornerFighter.id,
          name: b.blueCornerFighter.fullName,
          record: formatFighterRecord(b.blueCornerFighter.recordWins, b.blueCornerFighter.recordLosses, b.blueCornerFighter.recordDraws),
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
  });
});

export interface UfcFighterBio {
  id: string;
  name: string;
  nickname: string | null;
  division: string | null;
  record: string | null;
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
