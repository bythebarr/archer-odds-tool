import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { toLineRow, type GameLineRow } from "./games";

export interface PlayerSummary {
  id: string;
  name: string;
}

export interface MatchSummary {
  id: string;
  scheduledStartUtc: Date;
  status: string;
  homePlayer: PlayerSummary;
  awayPlayer: PlayerSummary;
}

/**
 * homePlayer/awayPlayer are nullable at the schema level (MLB Game rows use
 * homeTeam/awayTeam instead), but every query in this file filters
 * sport: "tennis" — the same DB CHECK constraint that guarantees MLB rows'
 * team fields are set guarantees tennis rows' player fields are set. See
 * games.ts's toGameSummary for the MLB-side equivalent.
 */
function toMatchSummary(g: {
  id: string;
  scheduledStartUtc: Date;
  status: string;
  homePlayer: { id: string; name: string } | null;
  awayPlayer: { id: string; name: string } | null;
}): MatchSummary {
  return {
    id: g.id,
    scheduledStartUtc: g.scheduledStartUtc,
    status: g.status,
    homePlayer: g.homePlayer!,
    awayPlayer: g.awayPlayer!,
  };
}

export interface MatchWithLines {
  match: MatchSummary;
  lines: GameLineRow[];
}

/**
 * A single tennis match plus its current (h2h-only) lines. Wrapped in
 * React's cache() for the same reason as games.ts's getGameWithLines — a
 * future generateMetadata call can share this request's DB round-trip.
 */
export const getMatchWithLines = cache(async function getMatchWithLines(
  matchId: string
): Promise<MatchWithLines | null> {
  const match = await prisma.game.findUnique({
    where: { id: matchId, sport: "tennis" },
    include: { homePlayer: true, awayPlayer: true },
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
 * Every not-yet-decided tennis match with current lines — the /tennis list
 * view. No date filter (unlike MLB's listGamesWithLinesForDate): tennis
 * matches don't cleanly bucket into "today" the way a single-timezone MLB
 * slate does, and v1 tracks at most one allowlisted tournament (~10-20
 * matches) at a time, so a full list is the right scale.
 */
export async function listTennisMatchesWithLines(): Promise<MatchWithLines[]> {
  const matches = await prisma.game.findMany({
    where: { sport: "tennis", status: { in: ["scheduled", "live"] } },
    orderBy: { scheduledStartUtc: "asc" },
    include: {
      homePlayer: true,
      awayPlayer: true,
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
