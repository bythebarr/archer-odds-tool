import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { toLineRow, type GameLineRow } from "./games";

export interface NflTeamSummary {
  id: string;
  name: string;
  abbreviation: string;
}

export interface NflGameSummary {
  id: string;
  scheduledStartUtc: Date;
  status: string;
  homeTeam: NflTeamSummary;
  awayTeam: NflTeamSummary;
}

/**
 * homeTeam/awayTeam are nullable at the schema level (tennis rows use
 * homePlayer/awayPlayer instead), but every query here filters sport: "nfl",
 * and NFL sits on the team-pair branch of the game_sport_competitor_check
 * constraint — so the DB itself guarantees both are set. Same reasoning as
 * soccerMatches.ts's toMatchSummary.
 */
function toGameSummary(g: {
  id: string;
  scheduledStartUtc: Date;
  status: string;
  homeTeam: { id: string; name: string; abbreviation: string } | null;
  awayTeam: { id: string; name: string; abbreviation: string } | null;
}): NflGameSummary {
  return {
    id: g.id,
    scheduledStartUtc: g.scheduledStartUtc,
    status: g.status,
    homeTeam: g.homeTeam!,
    awayTeam: g.awayTeam!,
  };
}

export interface NflGameWithLines {
  game: NflGameSummary;
  lines: GameLineRow[];
}

/**
 * One NFL game plus its current lines. cache()d for the same reason as
 * games.ts's getGameWithLines — a generateMetadata call can share the round-trip.
 */
export const getNflGameWithLines = cache(async function getNflGameWithLines(
  gameId: string
): Promise<NflGameWithLines | null> {
  const game = await prisma.game.findUnique({
    where: { id: gameId, sport: "nfl" },
    include: { homeTeam: true, awayTeam: true },
  });
  if (!game) return null;

  const lines = await prisma.currentOddsLine.findMany({
    where: { gameId },
    include: { book: true },
    orderBy: [{ side: "asc" }, { priceAmerican: "asc" }],
  });

  return { game: toGameSummary(game), lines: lines.map(toLineRow) };
});

/**
 * Every upcoming NFL game with current lines — the /nfl list view.
 *
 * No date filter, unlike MLB's date-scoped board: an NFL slate is one week of
 * games, not a nightly card, so the whole upcoming set IS the natural page. That's
 * also why `meta.carriesDate` is false for NFL.
 */
export async function listNflGamesWithLines(): Promise<NflGameWithLines[]> {
  const games = await prisma.game.findMany({
    where: { sport: "nfl", status: { in: ["scheduled", "live"] } },
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

  return games.map((g) => ({
    game: toGameSummary(g),
    lines: g.currentLines.map(toLineRow),
  }));
}
