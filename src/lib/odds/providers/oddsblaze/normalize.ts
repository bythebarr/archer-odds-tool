/**
 * OddsBlaze → our internal odds model.
 *
 * The job: take N single-book OddsBlaze responses (the fan-out) and produce the
 * same `OddsApiEvent[]` shape `storeBookmakerOdds` already consumes, so OddsBlaze
 * reuses the entire existing write path unchanged. Two shape gaps to bridge:
 *
 *   1. OddsBlaze's `odds` is a FLAT array per book; ours nests book→market→outcome.
 *      We regroup the flat entries into markets keyed by our vocabulary.
 *   2. OddsBlaze names markets in prose ("Run Line") and prices as strings; the map
 *      below translates the names and we parse the prices.
 *
 * Only game lines are mapped here (moneyline/spread/total), both main AND the full
 * alternate ladder — OddsBlaze ships every rung in the same per-book response
 * (main=false entries of the same market), so alt spreads/totals cost no extra
 * request, unlike TOA/Parlay's per-event alt fetch. Props and derivative markets
 * (innings, team totals) are a separate lane and deliberately dropped.
 */
import type {
  OddsApiEvent,
  OddsApiBookmaker,
  OddsApiMarket,
  OddsApiMarketKey,
  OddsApiOutcome,
} from "@/lib/odds/oddsApiClient";
import { canonicalBookKey } from "./books";
import type { OddsBlazeOdd, OddsBlazeOddsResponse } from "./client";

/**
 * OddsBlaze market NAME → our market key, per league.
 *
 * Only MLB is populated: its three game-line names were verified against a live
 * response (2026-07-22). Other leagues name their markets differently ("Point
 * Spread", "Total Points", set/game markets for tennis) and get added here only
 * after the same live check — we don't guess a name we haven't seen, because a
 * wrong key silently drops the market rather than erroring.
 */
const MARKET_NAME_MAP: Record<string, Record<string, OddsApiMarketKey>> = {
  mlb: {
    Moneyline: "h2h",
    "Run Line": "spreads",
    "Total Runs": "totals",
  },
};

/** The OddsBlaze market names to request for a league's game lines (server-side filter). */
export function gameLineMarketNames(league: string): string[] {
  return Object.keys(MARKET_NAME_MAP[league] ?? {});
}

/** Whether we have a game-line mapping for this league at all. */
export function supportsLeague(league: string): boolean {
  return MARKET_NAME_MAP[league] != null;
}

/** A normalized event, plus the stable external id OddsBlaze hands us for free. */
export interface OddsBlazeNormalizedEvent extends OddsApiEvent {
  /**
   * MLB Stats API gamePk from OddsBlaze `mappings.MLB.id`, when present. This is
   * the whole reason to prefer OddsBlaze for MLB: the caller can join to the
   * results feed on a stable id instead of ET-date name matching.
   */
  mlbGameId?: number;
}

/**
 * The alternate-market key for a base game line, or null if the line has no
 * alternate concept. Moneyline has no alt ladder — a non-main moneyline isn't a
 * thing, so it's dropped rather than forced into a market key that doesn't exist.
 */
function toAlternateMarketKey(base: OddsApiMarketKey): OddsApiMarketKey | null {
  if (base === "spreads") return "alternate_spreads";
  if (base === "totals") return "alternate_totals";
  return null;
}

function outcomeFromOdd(odd: OddsBlazeOdd, marketKey: OddsApiMarketKey): OddsApiOutcome | null {
  const price = Number.parseInt(odd.price, 10);
  // A suspended/priceless entry can't be stored; skip it rather than write a NaN.
  if (!Number.isFinite(price)) return null;

  if (marketKey === "totals") {
    // storeOdds's outcomeToSide expects exactly "Over"/"Under" — OddsBlaze puts
    // that on selection.side, while `name` carries the line ("Over 4.5").
    const side = odd.selection?.side;
    if (side !== "Over" && side !== "Under") return null;
    return { name: side, price, point: odd.selection?.line };
  }

  // h2h / spreads: the outcome must match a competitor name for outcomeToSide to
  // resolve a side. selection.name is the clean team name (vs `name`, which on a
  // run line is "New York Mets -3.5").
  const name = odd.selection?.name;
  if (!name) return null;
  const outcome: OddsApiOutcome = { name, price };
  if (typeof odd.selection?.line === "number") outcome.point = odd.selection.line;
  return outcome;
}

/**
 * Merge per-book OddsBlaze responses into `OddsApiEvent[]`, joined on OddsBlaze's
 * event id (the same id across every book's response for the same game).
 */
export function normalizeOddsBlazeOdds(
  league: string,
  responses: OddsBlazeOddsResponse[],
  { skipLive = true, alternates = true }: { skipLive?: boolean; alternates?: boolean } = {}
): OddsBlazeNormalizedEvent[] {
  const marketMap = MARKET_NAME_MAP[league];
  if (!marketMap) throw new Error(`OddsBlaze: no game-line market map for league '${league}'`);

  const byEvent = new Map<
    string,
    { home: string; away: string; date: string; mlbGameId?: number; books: OddsApiBookmaker[] }
  >();

  for (const resp of responses) {
    const canonKey = canonicalBookKey(resp.sportsbook.id);
    if (!canonKey) continue; // a book we translate-and-drop

    for (const ev of resp.events) {
      if (skipLive && ev.live) continue;

      const marketsByKey = new Map<OddsApiMarketKey, OddsApiMarket>();
      for (const odd of ev.odds ?? []) {
        const baseKey = marketMap[odd.market];
        if (!baseKey) continue;
        const isMain = odd.main !== false; // undefined counts as main
        if (!isMain && !alternates) continue;
        // An alt rung goes under the alternate_* key so storeOdds flags it
        // isAlternate; a base with no alt concept (moneyline) drops its non-main
        // entries. The SIDE logic still keys off the base type (Over/Under vs team).
        const marketKey = isMain ? baseKey : toAlternateMarketKey(baseKey);
        if (!marketKey) continue;
        const outcome = outcomeFromOdd(odd, baseKey);
        if (!outcome) continue;
        let market = marketsByKey.get(marketKey);
        if (!market) {
          market = { key: marketKey, outcomes: [] };
          marketsByKey.set(marketKey, market);
        }
        market.outcomes.push(outcome);
      }
      if (marketsByKey.size === 0) continue;

      const gamePk = Number.parseInt(ev.mappings?.MLB?.id ?? "", 10);
      const acc =
        byEvent.get(ev.id) ??
        {
          home: ev.teams.home.name,
          away: ev.teams.away.name,
          date: ev.date,
          mlbGameId: Number.isFinite(gamePk) ? gamePk : undefined,
          books: [] as OddsApiBookmaker[],
        };
      acc.books.push({
        key: canonKey,
        title: resp.sportsbook.name,
        last_update: resp.updated,
        markets: [...marketsByKey.values()],
      });
      byEvent.set(ev.id, acc);
    }
  }

  const out: OddsBlazeNormalizedEvent[] = [];
  for (const [id, acc] of byEvent) {
    if (!acc.books.length) continue;
    out.push({
      id,
      sport_key: league,
      commence_time: acc.date,
      home_team: acc.home,
      away_team: acc.away,
      bookmakers: acc.books,
      mlbGameId: acc.mlbGameId,
    });
  }
  return out;
}
