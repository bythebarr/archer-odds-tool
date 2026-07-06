import { prisma } from "@/lib/prisma";
import type { MarketType, Side } from "@/generated/prisma/client";
import type { OddsApiBookmaker } from "./oddsApiClient";
import { ALLOWED_BOOK_KEYS } from "./bookAllowlist";

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
  homeCompetitorName: string,
  awayCompetitorName: string
): Side | null {
  if (marketType === "totals") {
    if (outcomeName === "Over") return "over";
    if (outcomeName === "Under") return "under";
    return null;
  }
  if (outcomeName === homeCompetitorName) return "home";
  if (outcomeName === awayCompetitorName) return "away";
  // Soccer's 3-way h2h market only — MLB/tennis h2h never produces this
  // outcome name. Stored for line-shopping only; see lineEconomics.ts's
  // 2-way-only devig, which deliberately doesn't run against soccer h2h.
  if (marketType === "h2h" && outcomeName === "Draw") return "draw";
  return null;
}

/**
 * Writes every allowed book's odds for one game/match: an append-only
 * OddsSnapshot row per (book, market, side, point) plus an upserted
 * CurrentOddsLine for O(1) "what's the price right now" lookups. Sport-
 * agnostic — shared by MLB's bulk poll + per-event alt-lines fetch and by
 * tennis's poller, since OddsSnapshot/CurrentOddsLine are keyed only by
 * gameId with no team/player coupling.
 */
export async function storeBookmakerOdds(
  gameId: string,
  homeCompetitorName: string,
  awayCompetitorName: string,
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
        const side = outcomeToSide(marketType, outcome.name, homeCompetitorName, awayCompetitorName);
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
