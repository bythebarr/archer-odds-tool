import { prisma } from "@/lib/prisma";
import type { MarketType, Side } from "@/generated/prisma/client";
import type { OddsApiBookmaker, OddsApiMarket } from "./oddsApiClient";
import { impliedProbability, isCoherentMarket, overround } from "./marketSanity";
import { ALLOWED_BOOK_KEYS } from "./bookAllowlist";

/**
 * Collapse a book that quotes the SAME market twice in one payload, keeping the
 * worse price on every outcome.
 *
 * ParlayAPI does this routinely: measured 2026-07-21, FanDuel appeared twice
 * with two different h2h blocks on 5 of 15 MLB games — Yankees at -138 in one
 * and -168 in the other, a 30-cent spread on the same book, same game, same
 * market. Nothing in the payload says which is live. Before this, the loop below
 * simply processed both and whichever landed last won, so a third of games
 * carried an arbitrary FanDuel number, and "the odds don't match the book" was
 * the visible symptom.
 *
 * Taking the WORSE side of the ambiguity is the deliberate choice. The failure
 * we can't afford is advertising a price a member then can't get: that invents
 * edge, and an EV number built on a phantom price is worse than no number. The
 * opposite error — quoting someone a slightly short price — costs us a play we
 * could have had, and is recoverable. So: highest implied probability wins,
 * which is the same rule for American, positive or negative.
 *
 * Freshness is taken from the OLDER block for the same reason — given two
 * timestamps and no way to tell which quote is current, claiming the newer one
 * overstates what we actually know.
 *
 * Exported for tests. A book quoting a market once (the normal case) passes
 * through untouched, including its object identity.
 */
export function collapseDuplicateMarkets(markets: OddsApiMarket[]): OddsApiMarket[] {
  const byKey = new Map<string, OddsApiMarket[]>();
  for (const market of markets) {
    byKey.set(market.key, [...(byKey.get(market.key) ?? []), market]);
  }

  return [...byKey.values()].map((blocks) => {
    if (blocks.length === 1) return blocks[0];

    // Outcomes are only "the same bet" at the same number — Over 8.5 and Over
    // 9.5 are different rungs and must not collapse into each other.
    const worst = new Map<string, { outcome: OddsApiMarket["outcomes"][number]; prob: number }>();
    for (const block of blocks) {
      for (const outcome of block.outcomes) {
        // A suspended market comes back priceless; it can't be compared, and it
        // must not win by default (see oddsApiClient on ParlayAPI's null prices).
        if (typeof outcome.price !== "number" || !Number.isFinite(outcome.price)) continue;
        const key = `${outcome.name}|${outcome.point ?? "ml"}`;
        const prob = impliedProbability(outcome.price);
        const held = worst.get(key);
        if (!held || prob > held.prob) worst.set(key, { outcome, prob });
      }
    }

    const lastUpdates = blocks.map((b) => b.last_update).filter((u): u is string => Boolean(u));
    return {
      ...blocks[0],
      last_update: lastUpdates.length ? lastUpdates.sort()[0] : blocks[0].last_update,
      outcomes: [...worst.values()].map((w) => w.outcome),
    };
  });
}

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
 * Drops main-line CurrentOddsLine rows this poll didn't refresh.
 *
 * CurrentOddsLine was upsert-only and never pruned, which quietly broke the
 * one thing the board promises — the best available price. Two ways:
 *
 *  - A book that stops offering a market keeps its last price forever, and
 *    since "best price" is a max across books, a withdrawn number wins the
 *    comparison indefinitely.
 *  - `point` is part of the row's unique key, so every historical number
 *    accumulates as its own "current" row. Measured on one WSH @ COL game:
 *    seven distinct spreads (-2.5 through 4.5) and five totals (12 through
 *    15.5) all live at once. Books never disagree by 3.5 runs on a main
 *    total; most of those rows were simply old.
 *
 * `OddsSnapshot` remains append-only — the price history lives there, and this
 * touches none of it. This is only about what "current" means.
 *
 * Alt lines are exempt BY DEFAULT: on TOA/Parlay they're fetched for one game per
 * poll (MAX_ALT_LINE_GAMES_PER_POLL) in a separate per-event call, so pruning them
 * on a poll that didn't request them would delete the whole ladder every time. A
 * caller whose single payload DID carry the full alt ladder (OddsBlaze does) passes
 * `includeAlternates` to prune stale alt rungs too — otherwise a book's withdrawn
 * alt line would win the best-price max forever, the same bug this fixes for mains.
 *
 * Only ever called for a fetch that actually carried the main markets — see
 * `retireStale` in storeBookmakerOdds. The alt-lines fetch runs as a SECOND call
 * for the same game moments later, and pruning on it would delete the main rows
 * the first call just wrote.
 */
async function retireStaleCurrentLines(
  gameId: string,
  startedAt: Date,
  includeAlternates: boolean
): Promise<void> {
  await prisma.currentOddsLine.deleteMany({
    where: {
      gameId,
      ...(includeAlternates ? {} : { isAlternate: false }),
      polledAt: { lt: startedAt },
    },
  });
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
  bookmakers: OddsApiBookmaker[],
  /**
   * retireStale: whether this payload is the game's full main-line picture, so
   *   rows it doesn't refresh can be retired. False for the per-event ALT-lines
   *   fetch, which is a partial second call for a game already written this poll.
   * retireStaleAlternates: also retire stale ALT rungs — only for a payload that
   *   carried the whole ladder in one call (OddsBlaze). Left false for TOA/Parlay,
   *   whose alts arrive separately and must keep their own lifecycle.
   */
  {
    retireStale = true,
    retireStaleAlternates = false,
  }: { retireStale?: boolean; retireStaleAlternates?: boolean } = {}
): Promise<number> {
  let snapshotsWritten = 0;
  // Everything written by THIS call, so anything older can be retired below.
  const startedAt = new Date();

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
    const orderedMarkets = collapseDuplicateMarkets(bookmaker.markets).sort(
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

      // Reject the whole market if its sides don't add up to a plausible book.
      // Grouped by point, since a totals/spreads market is only two-way AT a
      // given number — 8.5 and 9.5 are separate markets, not one four-way.
      //
      // MAIN markets only. A full ALTERNATE spread ladder is two-directional —
      // both teams appear at ±X (Rockies +4.5 AND Nats +4.5) — so grouping by raw
      // point pairs non-complementary sides and every rung reads as incoherent,
      // dropping the whole ladder. The guard exists to keep fake EV off the card's
      // PRIMARY board (see marketSanity); alt rungs are a secondary shopping
      // surface and can't be point-paired this way, so they skip the check. The
      // per-outcome null-price skip below still applies to them.
      const incoherentPoints = new Set<number | null>();
      if (!isAlternate) {
        const byPoint = new Map<number | null, number[]>();
        for (const o of market.outcomes) {
          if (typeof o.price !== "number" || !Number.isFinite(o.price)) continue;
          const key = o.point ?? null;
          byPoint.set(key, [...(byPoint.get(key) ?? []), o.price]);
        }
        for (const [point, prices] of byPoint) {
          if (!isCoherentMarket(prices)) incoherentPoints.add(point);
        }
        if (incoherentPoints.size) {
          console.warn(
            `storeOdds: dropping ${bookmaker.key} ${market.key} — implausible market ` +
              [...incoherentPoints].map((pt) => `${pt ?? "ml"}:${overround(byPoint.get(pt) ?? []).toFixed(3)}`).join(", ")
          );
        }
      }

      for (const outcome of market.outcomes) {
        if (incoherentPoints.has(outcome.point ?? null)) continue;
        const side = outcomeToSide(marketType, outcome.name, homeCompetitorName, awayCompetitorName);
        if (!side) continue;
        // A book can list an outcome with NO price — a suspended or pulled
        // market. ParlayAPI surfaces these as `price: null` where TOA simply
        // omitted them. Skip rather than store: a null price isn't a number we
        // can line-shop, de-vig, or grade, and storing one poisons every
        // best-price comparison downstream.
        if (typeof outcome.price !== "number" || !Number.isFinite(outcome.price)) continue;

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

  if (retireStale) await retireStaleCurrentLines(gameId, startedAt, retireStaleAlternates);

  return snapshotsWritten;
}
