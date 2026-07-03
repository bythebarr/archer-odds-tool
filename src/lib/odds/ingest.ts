import { prisma } from "@/lib/prisma";
import type { MarketType, Side } from "@/generated/prisma/client";
import {
  fetchMlbOdds,
  fetchEventAlternateOdds,
  type OddsApiBookmaker,
  type OddsApiEvent,
  type OddsApiMarketKey,
} from "./oddsApiClient";
import { ALLOWED_BOOK_KEYS } from "./bookAllowlist";
import { IMMINENT_THRESHOLD_MINUTES } from "@/lib/pollingPolicy";

/** Games are matched to Odds API events within this window around commence_time. */
const MATCH_WINDOW_HOURS = 6;

function isAllowedBook(key: string): boolean {
  return (ALLOWED_BOOK_KEYS as readonly string[]).includes(key);
}

function marketKeyToMarketType(key: string): MarketType | null {
  if (key === "h2h") return "h2h";
  if (key === "spreads" || key === "alternate_spreads") return "spreads";
  if (key === "totals" || key === "alternate_totals") return "totals";
  return null;
}

function isAlternateMarketKey(key: string): boolean {
  return key === "alternate_spreads" || key === "alternate_totals";
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

/**
 * Writes every allowed book's odds for one game: an append-only OddsSnapshot
 * row per (book, market, side, point) plus an upserted CurrentOddsLine for
 * O(1) "what's the price right now" lookups. Shared by the main bulk poll
 * and the per-event alt-lines fetch — same shape either way, just a
 * different subset of markets/bookmakers coming in.
 */
async function storeBookmakerOdds(
  gameId: string,
  homeTeamName: string,
  awayTeamName: string,
  bookmakers: OddsApiBookmaker[]
): Promise<number> {
  let snapshotsWritten = 0;

  for (const bookmaker of bookmakers) {
    if (!isAllowedBook(bookmaker.key)) continue;

    await prisma.sportsbook.upsert({
      where: { key: bookmaker.key },
      create: { key: bookmaker.key, displayName: bookmaker.title, region: "us" },
      update: { displayName: bookmaker.title },
    });

    const polledAt = new Date();

    // Process main markets before alt markets regardless of API response
    // order, so a genuine main-line row is always the one that "creates"
    // a given point (see the upsert below, which only sets isAlternate
    // on create) — enforced here in code, not left to request-param order.
    const orderedMarkets = [...bookmaker.markets].sort(
      (a, b) => Number(isAlternateMarketKey(a.key)) - Number(isAlternateMarketKey(b.key))
    );

    for (const market of orderedMarkets) {
      const marketType = marketKeyToMarketType(market.key);
      if (!marketType) continue;
      const isAlternate = isAlternateMarketKey(market.key);
      // The bulk endpoint puts last_update on the bookmaker; the per-event
      // endpoint (used for alt lines) puts it on the market instead — prefer
      // whichever is actually present, falling back to "now" if neither is.
      const sourceLastUpdate = new Date(market.last_update ?? bookmaker.last_update ?? polledAt);

      for (const outcome of market.outcomes) {
        const side = outcomeToSide(marketType, outcome.name, homeTeamName, awayTeamName);
        if (!side) continue;

        await prisma.oddsSnapshot.create({
          data: {
            gameId,
            bookKey: bookmaker.key,
            marketType,
            side,
            point: outcome.point ?? null,
            priceAmerican: outcome.price,
            polledAt,
            sourceLastUpdate,
            isAlternate,
          },
        });
        snapshotsWritten++;

        // h2h has no point, but point now sits in CurrentOddsLine's unique
        // key — Postgres treats NULL as never equal to NULL, so a nullable
        // point would break upsert idempotency for h2h (each poll would
        // insert a duplicate instead of updating). 0 is a sentinel here,
        // never a real point; normalized back to null in toLineRow().
        const currentLinePoint = marketType === "h2h" ? 0 : outcome.point ?? 0;

        await prisma.currentOddsLine.upsert({
          where: {
            gameId_bookKey_marketType_side_point: {
              gameId,
              bookKey: bookmaker.key,
              marketType,
              side,
              point: currentLinePoint,
            },
          },
          create: {
            gameId,
            bookKey: bookmaker.key,
            marketType,
            side,
            point: currentLinePoint,
            priceAmerican: outcome.price,
            polledAt,
            isAlternate,
          },
          update: {
            priceAmerican: outcome.price,
            polledAt,
            // isAlternate intentionally omitted: only set on create, so a
            // main-line row's flag can never flip to true just because a
            // later alt-market response also covers the same point.
          },
        });
      }
    }
  }

  return snapshotsWritten;
}

export interface PollOddsSummary {
  eventsFetched: number;
  gamesMatched: number;
  gamesUnmatched: string[];
  snapshotsWritten: number;
  altLineGamesPolled: number;
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

/**
 * Fetches current MLB odds and archives them (see storeBookmakerOdds for the
 * write shape). Only books in ALLOWED_BOOK_KEYS are stored.
 *
 * Alt lines (alternate_spreads/alternate_totals) aren't part of the bulk
 * fetch — The Odds API only serves them one event at a time, at ~4 credits
 * per game (2 markets x 2 regions), which is too expensive to fetch for
 * every game on every poll. Instead, once the main bulk odds are matched to
 * games, any game starting within IMMINENT_THRESHOLD_MINUTES gets one extra
 * per-event call for its alt lines — bounding the extra cost to however many
 * games are actually close to first pitch right now, not the whole slate.
 */
export async function pollAndStoreOdds(
  markets: OddsApiMarketKey[] = ["h2h", "spreads", "totals"]
): Promise<PollOddsSummary> {
  const { events, creditsUsed: mainCreditsUsed, creditsRemaining: mainCreditsRemaining } =
    await fetchMlbOdds(markets);

  let gamesMatched = 0;
  let snapshotsWritten = 0;
  let altLineGamesPolled = 0;
  let creditsUsed = mainCreditsUsed ?? 0;
  let creditsRemaining = mainCreditsRemaining;
  const gamesUnmatched: string[] = [];
  const now = new Date();

  for (const event of events) {
    const game = await matchGameForEvent(event);
    if (!game) {
      gamesUnmatched.push(`${event.away_team} @ ${event.home_team} (${event.commence_time})`);
      continue;
    }
    gamesMatched++;

    snapshotsWritten += await storeBookmakerOdds(
      game.id,
      event.home_team,
      event.away_team,
      event.bookmakers
    );

    const minutesToStart = (game.scheduledStartUtc.getTime() - now.getTime()) / 60_000;
    const isImminent = minutesToStart >= 0 && minutesToStart <= IMMINENT_THRESHOLD_MINUTES;
    if (!isImminent) continue;

    try {
      const altResult = await fetchEventAlternateOdds(event.id);
      snapshotsWritten += await storeBookmakerOdds(
        game.id,
        altResult.event.home_team,
        altResult.event.away_team,
        altResult.event.bookmakers
      );
      altLineGamesPolled++;
      if (altResult.creditsUsed !== null) creditsUsed += altResult.creditsUsed;
      if (altResult.creditsRemaining !== null) creditsRemaining = altResult.creditsRemaining;
    } catch (error) {
      // One game's alt-line fetch failing shouldn't abort the whole poll —
      // the main line for this game already landed above.
      console.error(`Alt-line fetch failed for event ${event.id}:`, error);
    }
  }

  return {
    eventsFetched: events.length,
    gamesMatched,
    gamesUnmatched,
    snapshotsWritten,
    altLineGamesPolled,
    creditsUsed,
    creditsRemaining,
  };
}
