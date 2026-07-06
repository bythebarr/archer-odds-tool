import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { toLineRow, type GameLineRow } from "./games";

export interface SoccerTeamSummary {
  id: string;
  name: string;
  abbreviation: string;
}

export interface SoccerMatchSummary {
  id: string;
  scheduledStartUtc: Date;
  status: string;
  homeTeam: SoccerTeamSummary;
  awayTeam: SoccerTeamSummary;
}

/**
 * homeTeam/awayTeam are nullable at the schema level (tennis Game rows use
 * homePlayer/awayPlayer instead), but every query in this file filters
 * sport: "soccer" — the same DB CHECK constraint that guarantees MLB rows'
 * team fields are set guarantees soccer rows' team fields are set too (both
 * share the team-pair branch of game_sport_competitor_check). See games.ts's
 * toGameSummary for the MLB-side equivalent.
 */
function toMatchSummary(g: {
  id: string;
  scheduledStartUtc: Date;
  status: string;
  homeTeam: { id: string; name: string; abbreviation: string } | null;
  awayTeam: { id: string; name: string; abbreviation: string } | null;
}): SoccerMatchSummary {
  return {
    id: g.id,
    scheduledStartUtc: g.scheduledStartUtc,
    status: g.status,
    homeTeam: g.homeTeam!,
    awayTeam: g.awayTeam!,
  };
}

export interface SoccerMatchWithLines {
  match: SoccerMatchSummary;
  lines: GameLineRow[];
}

/**
 * A single World Cup match plus its current (h2h-only) lines. Wrapped in
 * React's cache() for the same reason as games.ts's getGameWithLines — a
 * future generateMetadata call can share this request's DB round-trip.
 */
export const getSoccerMatchWithLines = cache(async function getSoccerMatchWithLines(
  matchId: string
): Promise<SoccerMatchWithLines | null> {
  const match = await prisma.game.findUnique({
    where: { id: matchId, sport: "soccer" },
    include: { homeTeam: true, awayTeam: true },
  });
  if (!match) return null;

  const lines = await prisma.currentOddsLine.findMany({
    where: { gameId: matchId },
    include: { book: true },
    orderBy: [{ side: "asc" }, { priceAmerican: "asc" }],
  });

  return {
    match: toMatchSummary(match),
    lines: lines.map(toLineRow),
  };
});

/**
 * Every not-yet-decided World Cup match with current lines — the /soccer
 * list view. No date filter, same rationale as tennis's listTennisMatchesWithLines:
 * a knockout-stage slate is small enough that a full list is the right scale.
 */
export async function listSoccerMatchesWithLines(): Promise<SoccerMatchWithLines[]> {
  const matches = await prisma.game.findMany({
    where: { sport: "soccer", status: { in: ["scheduled", "live"] } },
    orderBy: { scheduledStartUtc: "asc" },
    include: {
      homeTeam: true,
      awayTeam: true,
      currentLines: {
        include: { book: true },
        orderBy: [{ side: "asc" }, { priceAmerican: "asc" }],
      },
    },
  });

  return matches.map((m) => ({
    match: toMatchSummary(m),
    lines: m.currentLines.map(toLineRow),
  }));
}
