import type { ParlayPropRow, OddsApiBookmaker } from "@/lib/odds/oddsApiClient";
import { normalizeParlayMarketKey, looksLikePlayerName } from "./propMarkets";

/**
 * Reshape ParlayAPI's flat prop rows into the nested bookmakers → markets →
 * outcomes structure the rest of the app already speaks.
 *
 * Adapting at the edge rather than teaching the storage layer a second shape:
 * `storePlayerPropOdds` keeps its single input format, so the provider swap
 * costs one mapper instead of a rewrite of everything downstream. Same move as
 * the sport engine's adapters.
 *
 * The shapes differ in a way that matters. Parlay gives one row per
 * (event, book, player, market, line) with BOTH sides priced; TOA gave separate
 * Over/Under outcomes carrying the player in `description`. So one row becomes
 * up to two outcomes, and a row priced on only one side still yields the side
 * it has — a book quoting only the Over is perfectly normal and still shoppable.
 */

export interface GroupedProps {
  /** Parlay event id → the bookmakers for that event, TOA-shaped. */
  byEventId: Map<string, OddsApiBookmaker[]>;
  /** Rows dropped as unusable, by reason — reported, never silent. */
  skipped: { dfs: number; noLine: number; noPrice: number; unmappedMarket: number; notAPlayer: number };
}

export function groupPropRows(rows: ParlayPropRow[]): GroupedProps {
  // event → book → market → outcomes
  const events = new Map<string, Map<string, Map<string, OddsApiBookmaker["markets"][number]>>>();
  const titles = new Map<string, string>();
  const skipped = { dfs: 0, noLine: 0, noPrice: 0, unmappedMarket: 0, notAPlayer: 0 };

  for (const row of rows) {
    // DFS pick-em books quote a flat payout, not a two-sided market. Their
    // "price" isn't comparable to a sportsbook's, so including them would
    // corrupt both best-price shopping and any de-vig.
    if (row.is_dfs_flat_payout) {
      skipped.dfs++;
      continue;
    }
    if (row.line == null) {
      skipped.noLine++;
      continue;
    }
    if (row.over_price == null && row.under_price == null) {
      skipped.noPrice++;
      continue;
    }
    // Translate Parlay's vocabulary, and drop anything ambiguous or ungradeable
    // — see PARLAY_MARKET_KEY_TO_ODDS_API_KEY for why this is an allowlist.
    const marketKey = normalizeParlayMarketKey(row.market_key);
    if (!marketKey) {
      skipped.unmappedMarket++;
      continue;
    }
    if (!looksLikePlayerName(row.player)) {
      skipped.notAPlayer++;
      continue;
    }

    titles.set(row.bookmaker, row.bookmaker_title);
    const books = events.get(row.event_id) ?? new Map();
    events.set(row.event_id, books);
    const markets = books.get(row.bookmaker) ?? new Map();
    books.set(row.bookmaker, markets);
    const market = markets.get(marketKey) ?? { key: marketKey, outcomes: [] };
    markets.set(marketKey, market);

    // `description` carries the player name — that's where the storage layer
    // looks, matching TOA's per-event props response.
    if (row.over_price != null) {
      market.outcomes.push({
        name: "Over",
        price: row.over_price,
        point: row.line,
        description: row.player,
      });
    }
    if (row.under_price != null) {
      market.outcomes.push({
        name: "Under",
        price: row.under_price,
        point: row.line,
        description: row.player,
      });
    }
  }

  const byEventId = new Map<string, OddsApiBookmaker[]>();
  for (const [eventId, books] of events) {
    byEventId.set(
      eventId,
      [...books].map(([key, markets]) => ({
        key,
        title: titles.get(key) ?? key,
        markets: [...markets.values()],
      }))
    );
  }

  return { byEventId, skipped };
}
