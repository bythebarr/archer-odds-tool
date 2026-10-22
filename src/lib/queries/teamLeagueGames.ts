import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type { TeamLeagueSport } from "@/lib/teamLeague/league";
import { toLineRow, type GameLineRow } from "./games";

export interface TeamSummary {
  id: string;
  name: string;
  abbreviation: string;
}

export interface TeamGameSummary {
  id: string;
  scheduledStartUtc: Date;
  status: string;
  homeTeam: TeamSummary;
  awayTeam: TeamSummary;
}

/**
 * homeTeam/awayTeam are nullable at the schema level (tennis rows use
 * homePlayer/awayPlayer instead), but every query here filters on a team-league
 * sport, and those sit on the team-pair branch of the game_sport_competitor_check
 * constraint — so the DB itself guarantees both are set. Same reasoning as
 * soccerMatches.ts's toMatchSummary.
 */
function toGameSummary(g: {
  id: string;
  scheduledStartUtc: Date;
  status: string;
  homeTeam: { id: string; name: string; abbreviation: string } | null;
  awayTeam: { id: string; name: string; abbreviation: string } | null;
}): TeamGameSummary {
  return {
    id: g.id,
    scheduledStartUtc: g.scheduledStartUtc,
    status: g.status,
    homeTeam: g.homeTeam!,
    awayTeam: g.awayTeam!,
  };
}

export interface TeamGameWithLines {
  game: TeamGameSummary;
  lines: GameLineRow[];
}

/**
 * One team-league game plus its current lines. cache()d for the same reason as
 * games.ts's getGameWithLines — a generateMetadata call can share the round-trip.
 */
export const getTeamGameWithLines = cache(async function getTeamGameWithLines(
  sport: TeamLeagueSport,
  gameId: string
): Promise<TeamGameWithLines | null> {
  const game = await prisma.game.findUnique({
    where: { id: gameId, sport },
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
 * Every upcoming game in a league with current lines — the /nfl and /nba list views.
 *
 * No date filter, unlike MLB's date-scoped board: an NFL slate is one week of
 * games, and the books only hang NBA numbers a day or two out, so the whole
 * upcoming set IS the natural page. That's also why `meta.carriesDate` is false.
 */
export async function listTeamLeagueGamesWithLines(sport: TeamLeagueSport): Promise<TeamGameWithLines[]> {
  const games = await prisma.game.findMany({
    where: { sport, status: { in: ["scheduled", "live"] } },
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
