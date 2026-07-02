import { prisma } from "@/lib/prisma";
import type { MarketType, Side } from "@/generated/prisma/client";
import { fetchMlbOdds, type OddsApiEvent, type OddsApiMarketKey } from "./oddsApiClient";
import { ALLOWED_BOOK_KEYS } from "./bookAllowlist";

/** Games are matched to Odds API events within this window around commence_time. */
const MATCH_WINDOW_HOURS = 6;

function isAllowedBook(key: string): boolean {
  return (ALLOWED_BOOK_KEYS as readonly string[]).includes(key);
}

function marketKeyToMarketType(key: string): MarketType | null {
  if (key === "h2h" || key === "spreads" || key === "totals") return key;
  return null;
}

function outcomeToSide(
  marketType: MarketType,
  outcomeName: string,
  homeTeamName: string,
  awayTeamName: string
): Side | null {
  if (marketType === "totals") {
    if (outcomeName === "Over") return "over";
    if (outcomeName === "Under") return "under";
    return null;
  }
  if (outcomeName === homeTeamName) return "home";
  if (outcomeName === awayTeamName) return "away";
  return null;
}

/**
 * Finds the Game a given Odds API event refers to. Once matched, the event id
 * is cached on Game.oddsApiEventId so future polls skip the fuzzy lookup.
 */
async function matchGameForEvent(event: OddsApiEvent) {
  const existing = await prisma.game.findUnique({ where: { oddsApiEventId: event.id } });
  if (existing) return existing;

  const commenceTime = new Date(event.commence_time);
  const windowStart = new Date(commenceTime.getTime() - MATCH_WINDOW_HOURS * 3_600_000);
  const windowEnd = new Date(commenceTime.getTime() + MATCH_WINDOW_HOURS * 3_600_000);

  const candidates = await prisma.game.findMany({
    where: {
      scheduledStartUtc: { gte: windowStart, lte: windowEnd },
      homeTeam: { name: event.home_team },
      awayTeam: { name: event.away_team },
    },
  });

  const game = candidates[0];
  if (!game) return null;

  await prisma.game.update({ where: { id: game.id }, data: { oddsApiEventId: event.id } });
  return game;
}

export interface PollOddsSummary {
  eventsFetched: number;
  gamesMatched: number;
  gamesUnmatched: string[];
  snapshotsWritten: number;
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

/**
 * Fetches current MLB odds and archives them: an append-only OddsSnapshot row
 * per (game, book, market, side) plus an upserted CurrentOddsLine for O(1)
 * "what's the price right now" lookups. Only books in ALLOWED_BOOK_KEYS are stored.
 */
export async function pollAndStoreOdds(
  markets: OddsApiMarketKey[] = ["h2h", "spreads", "totals"]
): Promise<PollOddsSummary> {
  const { events, creditsUsed, creditsRemaining } = await fetchMlbOdds(markets);

  let gamesMatched = 0;
  let snapshotsWritten = 0;
  const gamesUnmatched: string[] = [];

  for (const event of events) {
    const game = await matchGameForEvent(event);
    if (!game) {
      gamesUnmatched.push(`${event.away_team} @ ${event.home_team} (${event.commence_time})`);
      continue;
    }
    gamesMatched++;

    for (const bookmaker of event.bookmakers) {
      if (!isAllowedBook(bookmaker.key)) continue;

      await prisma.sportsbook.upsert({
        where: { key: bookmaker.key },
        create: { key: bookmaker.key, displayName: bookmaker.title, region: "us" },
        update: { displayName: bookmaker.title },
      });

      const polledAt = new Date();
      const sourceLastUpdate = new Date(bookmaker.last_update);

      for (const market of bookmaker.markets) {
        const marketType = marketKeyToMarketType(market.key);
        if (!marketType) continue;

        for (const outcome of market.outcomes) {
          const side = outcomeToSide(marketType, outcome.name, event.home_team, event.away_team);
          if (!side) continue;

          await prisma.oddsSnapshot.create({
            data: {
              gameId: game.id,
              bookKey: bookmaker.key,
              marketType,
              side,
              point: outcome.point ?? null,
              priceAmerican: outcome.price,
              polledAt,
              sourceLastUpdate,
            },
          });
          snapshotsWritten++;

          await prisma.currentOddsLine.upsert({
            where: {
              gameId_bookKey_marketType_side: {
                gameId: game.id,
                bookKey: bookmaker.key,
                marketType,
                side,
              },
            },
            create: {
              gameId: game.id,
              bookKey: bookmaker.key,
              marketType,
              side,
              point: outcome.point ?? null,
              priceAmerican: outcome.price,
              polledAt,
            },
            update: {
              point: outcome.point ?? null,
              priceAmerican: outcome.price,
              polledAt,
            },
          });
        }
      }
    }
  }

  return {
    eventsFetched: events.length,
    gamesMatched,
    gamesUnmatched,
    snapshotsWritten,
    creditsUsed,
    creditsRemaining,
  };
}
