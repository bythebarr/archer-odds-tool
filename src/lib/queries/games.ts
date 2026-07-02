import { prisma } from "@/lib/prisma";
import { etDayBoundsUtc, todayEt } from "@/lib/dateEt";
import type { MarketType } from "@/generated/prisma/client";

export interface TeamSummary {
  id: string;
  name: string;
  abbreviation: string;
}

export interface GameSummary {
  id: string;
  mlbGameId: number;
  scheduledStartUtc: Date;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  homeTeam: TeamSummary;
  awayTeam: TeamSummary;
}

function toGameSummary(g: {
  id: string;
  mlbGameId: number;
  scheduledStartUtc: Date;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  homeTeam: { id: string; name: string; abbreviation: string };
  awayTeam: { id: string; name: string; abbreviation: string };
}): GameSummary {
  return {
    id: g.id,
    mlbGameId: g.mlbGameId,
    scheduledStartUtc: g.scheduledStartUtc,
    status: g.status,
    homeScore: g.homeScore,
    awayScore: g.awayScore,
    homeTeam: g.homeTeam,
    awayTeam: g.awayTeam,
  };
}

/** Games scheduled on the given ET calendar date (defaults to today, ET). */
export async function listGames(dateEt?: string): Promise<GameSummary[]> {
  const { gte, lt } = etDayBoundsUtc(dateEt ?? todayEt());

  const games = await prisma.game.findMany({
    where: { scheduledStartUtc: { gte, lt } },
    orderBy: { scheduledStartUtc: "asc" },
    include: { homeTeam: true, awayTeam: true },
  });

  return games.map(toGameSummary);
}

export interface GameLineRow {
  bookKey: string;
  bookName: string;
  marketType: MarketType;
  side: string;
  point: number | null;
  priceAmerican: number;
  polledAt: Date;
}

export interface GameWithLines {
  game: GameSummary;
  lines: GameLineRow[];
}

/** A single game plus its current lines, optionally filtered to one market. */
export async function getGameWithLines(
  gameId: string,
  market?: MarketType
): Promise<GameWithLines | null> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { homeTeam: true, awayTeam: true },
  });
  if (!game) return null;

  const lines = await prisma.currentOddsLine.findMany({
    where: { gameId, ...(market ? { marketType: market } : {}) },
    include: { book: true },
    orderBy: [{ marketType: "asc" }, { side: "asc" }, { priceAmerican: "asc" }],
  });

  return {
    game: toGameSummary(game),
    lines: lines.map((l) => ({
      bookKey: l.bookKey,
      bookName: l.book.displayName,
      marketType: l.marketType,
      side: l.side,
      point: l.point,
      priceAmerican: l.priceAmerican,
      polledAt: l.polledAt,
    })),
  };
}
