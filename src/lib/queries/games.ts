import { cache } from "react";
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

/**
 * `homeTeamId`/`awayTeamId`/`homeTeam`/`awayTeam`/`mlbGameId` are nullable at
 * the schema level (tennis `Game` rows use `homePlayer`/`awayPlayer`
 * instead), but every query in this file filters `sport: "mlb"` — a DB CHECK
 * constraint (see the tennis plan doc) guarantees those columns are non-null
 * whenever `sport = "mlb"`, so the `!` assertions below are backed by that
 * invariant, not just convention.
 */
function toGameSummary(g: {
  id: string;
  mlbGameId: number | null;
  scheduledStartUtc: Date;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  homeTeam: { id: string; name: string; abbreviation: string } | null;
  awayTeam: { id: string; name: string; abbreviation: string } | null;
}): GameSummary {
  return {
    id: g.id,
    mlbGameId: g.mlbGameId!,
    scheduledStartUtc: g.scheduledStartUtc,
    status: g.status,
    homeScore: g.homeScore,
    awayScore: g.awayScore,
    homeTeam: g.homeTeam!,
    awayTeam: g.awayTeam!,
  };
}

/** Games scheduled on the given ET calendar date (defaults to today, ET). */
export async function listGames(dateEt?: string): Promise<GameSummary[]> {
  const { gte, lt } = etDayBoundsUtc(dateEt ?? todayEt());

  const games = await prisma.game.findMany({
    where: { sport: "mlb", scheduledStartUtc: { gte, lt } },
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

/** Exported for reuse by tennisMatches.ts — this mapping is sport-agnostic (CurrentOddsLine has no team/player coupling). */
export function toLineRow(l: {
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

/**
 * A single game plus its current lines, optionally filtered to one market.
 * Wrapped in React's `cache()` so the game page's `generateMetadata` and its
 * page component (both calling this per request) share one DB round-trip
 * instead of two.
 */
export const getGameWithLines = cache(async function getGameWithLines(
  gameId: string,
  market?: MarketType
): Promise<GameWithLines | null> {
  const game = await prisma.game.findUnique({
    where: { id: gameId, sport: "mlb" },
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
});

/** Every game on the given ET calendar date, each with its current lines (all markets). */
export async function listGamesWithLinesForDate(dateEt: string): Promise<GameWithLines[]> {
  const { gte, lt } = etDayBoundsUtc(dateEt);

  const games = await prisma.game.findMany({
    where: { sport: "mlb", scheduledStartUtc: { gte, lt } },
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
