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
  isAlternate: boolean;
}

export interface GameWithLines {
  game: GameSummary;
  lines: GameLineRow[];
}

function toLineRow(l: {
  bookKey: string;
  book: { displayName: string };
  marketType: MarketType;
  side: string;
  point: number | null;
  priceAmerican: number;
  polledAt: Date;
  isAlternate: boolean;
}): GameLineRow {
  return {
    bookKey: l.bookKey,
    bookName: l.book.displayName,
    marketType: l.marketType,
    side: l.side,
    // CurrentOddsLine stores 0 (a sentinel, not a real point) for h2h rows —
    // see ingest.ts for why — normalized back to null here so every
    // consumer sees exactly what it did before alt lines existed.
    point: l.marketType === "h2h" ? null : l.point,
    priceAmerican: l.priceAmerican,
    polledAt: l.polledAt,
    isAlternate: l.isAlternate,
  };
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
    lines: lines.map(toLineRow),
  };
}

/** Every game on the given ET calendar date, each with its current lines (all markets). */
export async function listGamesWithLinesForDate(dateEt: string): Promise<GameWithLines[]> {
  const { gte, lt } = etDayBoundsUtc(dateEt);

  const games = await prisma.game.findMany({
    where: { scheduledStartUtc: { gte, lt } },
    orderBy: { scheduledStartUtc: "asc" },
    include: {
      homeTeam: true,
      awayTeam: true,
      currentLines: {
        include: { book: true },
        orderBy: [{ marketType: "asc" }, { side: "asc" }, { priceAmerican: "asc" }],
      },
    },
  });

  return games.map((g) => ({
    game: toGameSummary(g),
    lines: g.currentLines.map(toLineRow),
  }));
}
