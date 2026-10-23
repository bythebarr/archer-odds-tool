/**
 * NBA player-prop odds: one bulk ParlayAPI call for the whole slate, bound to our
 * games by team, matched to NbaPlayer by name, stored as snapshots plus the
 * current-line table the props finder reads.
 *
 * Same provider rules MLB props learned (see props/parlayProps.ts and
 * props/eventMatch.ts): DFS pick-em rows are not prices; `*_alt` rows may be
 * milestones; a two-sided quote has to add up like a market; and the props feed's
 * event ids are never joined against the game-lines feed's.
 */
import { prisma } from "@/lib/prisma";
import {
  activeOddsProvider,
  fetchBulkPlayerProps,
  fetchEventPlayerProps,
  type OddsApiEvent,
  type ParlayPropRow,
} from "@/lib/odds/oddsApiClient";
import { ALLOWED_BOOK_KEYS } from "@/lib/odds/bookAllowlist";
import { isCoherentMarket } from "@/lib/odds/marketSanity";
import { looksLikePlayerName } from "@/lib/props/propMarkets";
import type { NbaPropStat, Side } from "@/generated/prisma/client";
import { NBA_LEAGUE } from "./league";
import { NBA_MARKET_KEY_TO_STAT, nbaAltMarketStat } from "./propStats";

export interface NbaPropQuote {
  bookKey: string;
  bookTitle: string;
  player: string;
  stat: NbaPropStat;
  side: Side;
  point: number;
  priceAmerican: number;
}

export interface GroupedNbaProps {
  /** Feed event id → its teams and quotes. */
  events: Map<string, { homeTeam: string; awayTeam: string; quotes: NbaPropQuote[] }>;
  skipped: { dfs: number; noLine: number; noPrice: number; notAPlayer: number; incoherent: number; unmappedMarket: number };
  /** Market keys we don't map, with row counts — the list to read when a market seems missing. */
  unmappedMarketKeys: Record<string, number>;
}

/** Reshapes Parlay's flat rows (one per event/book/player/market/line, both sides priced) into per-side quotes. */
export function groupNbaPropRows(rows: ParlayPropRow[]): GroupedNbaProps {
  const events: GroupedNbaProps["events"] = new Map();
  const skipped = { dfs: 0, noLine: 0, noPrice: 0, notAPlayer: 0, incoherent: 0, unmappedMarket: 0 };
  const unmappedMarketKeys: Record<string, number> = {};

  for (const row of rows) {
    // Flat-payout pick-em: not a price, and would corrupt best-price shopping.
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

    const altStat = nbaAltMarketStat(row.market_key);
    const stat = altStat ?? NBA_MARKET_KEY_TO_STAT[row.market_key];
    if (!stat) {
      skipped.unmappedMarket++;
      unmappedMarketKeys[row.market_key] = (unmappedMarketKeys[row.market_key] ?? 0) + 1;
      continue;
    }

    // A whole-number alt line is a milestone ("25+ points"): it wins at exactly
    // 25, so it's Over 24.5, and it has no under. See nbaAltMarketStat.
    const milestone = altStat !== null && Number.isInteger(row.line);
    const point = milestone ? row.line - 0.5 : row.line;
    if (point <= 0) {
      skipped.noLine++;
      continue;
    }
    if (!looksLikePlayerName(row.player)) {
      skipped.notAPlayer++;
      continue;
    }
    if (
      !milestone &&
      row.over_price != null &&
      row.under_price != null &&
      !isCoherentMarket([row.over_price, row.under_price])
    ) {
      skipped.incoherent++;
      continue;
    }

    const event = events.get(row.event_id) ?? { homeTeam: row.home_team, awayTeam: row.away_team, quotes: [] };
    events.set(row.event_id, event);
    const base = { bookKey: row.bookmaker, bookTitle: row.bookmaker_title, player: row.player.trim(), stat, point };
    if (row.over_price != null) event.quotes.push({ ...base, side: "over", priceAmerican: row.over_price });
    if (row.under_price != null && !milestone) event.quotes.push({ ...base, side: "under", priceAmerican: row.under_price });
  }

  return { events, skipped, unmappedMarketKeys };
}

/**
 * Name key for matching a book's spelling to ESPN's: no accents, case, or
 * punctuation ("P.J. Washington" = "PJ Washington", "Jokić" = "Jokic").
 */
/**
 * The Odds API's per-event props, reshaped into the flat Parlay rows the rest of
 * this file reads: TOA nests bookmaker → market → outcomes with one outcome per
 * side, keyed by player (`description`) and line (`point`). Pairing the two
 * sides here means one grouping path serves both providers.
 */
export function toaEventToPropRows(event: OddsApiEvent): ParlayPropRow[] {
  const rows = new Map<string, ParlayPropRow>();
  for (const book of event.bookmakers ?? []) {
    for (const market of book.markets ?? []) {
      for (const o of market.outcomes ?? []) {
        const side = o.name.toLowerCase();
        if (!o.description || (side !== "over" && side !== "under")) continue;
        const key = `${book.key}|${market.key}|${o.description}|${o.point ?? ""}`;
        const row = rows.get(key) ?? {
          event_id: event.id,
          sport_key: event.sport_key,
          home_team: event.home_team,
          away_team: event.away_team,
          commence_time: event.commence_time,
          bookmaker: book.key,
          bookmaker_title: book.title,
          player: o.description,
          market_key: market.key,
          market: market.key,
          line: o.point ?? null,
          over_price: null,
          under_price: null,
        };
        if (side === "over") row.over_price = o.price;
        else row.under_price = o.price;
        rows.set(key, row);
      }
    }
  }
  return [...rows.values()];
}

/** The Odds API's NBA prop markets we map (see NBA_MARKET_KEY_TO_STAT); billed per market returned, per region, per game. */
export const TOA_NBA_PROP_MARKETS = [
  "player_points",
  "player_rebounds",
  "player_assists",
  "player_threes",
  "player_points_rebounds_assists",
  "player_points_rebounds",
  "player_points_assists",
  "player_rebounds_assists",
  "player_steals",
  "player_blocks",
];
const TOA_PROP_REGIONS = ["us", "us2"];
/**
 * TOA bills per game, so its props poll only covers games tipping within this
 * window — books post props the morning of, and tomorrow's games are picked up
 * by tomorrow's polls. Parlay's slate-wide call has no per-game cost.
 */
const TOA_LOOKAHEAD_HOURS = 14;

export function normalizePlayerName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stripSuffix(normalized: string): string {
  return normalized.replace(/\s+(jr|sr|ii|iii|iv)$/, "").trim();
}

/**
 * Normalized name → NbaPlayer id, plus suffix-less aliases ("Jaren Jackson" for
 * "Jaren Jackson Jr.") where exactly one player owns the alias — an alias that
 * could mean two players would attach a prop to the wrong history.
 */
export function buildNbaPlayerIndex(players: { id: string; fullName: string }[]): Map<string, string> {
  const index = new Map<string, string>();
  const ambiguous = new Set<string>();
  const add = (key: string, id: string) => {
    if (ambiguous.has(key)) return;
    const owner = index.get(key);
    if (owner && owner !== id) {
      index.delete(key);
      ambiguous.add(key);
      return;
    }
    index.set(key, id);
  };
  for (const p of players) add(normalizePlayerName(p.fullName), p.id);
  for (const p of players) {
    const full = normalizePlayerName(p.fullName);
    const alias = stripSuffix(full);
    if (alias !== full && !index.has(alias)) add(alias, p.id);
  }
  return index;
}

export function lookupNbaPlayer(index: Map<string, string>, feedName: string): string | null {
  const key = normalizePlayerName(feedName);
  return index.get(key) ?? index.get(stripSuffix(key)) ?? null;
}

export interface PollNbaPropsSummary {
  status: "ok" | "no-games" | "unsupported-provider";
  gamesConsidered: number;
  gamesStored: number;
  rowsFetched: number;
  quotesStored: number;
  staleLinesRemoved: number;
  skipped: GroupedNbaProps["skipped"];
  unmappedMarketKeys: Record<string, number>;
  /** Feed events we couldn't bind to one of our games. */
  unmatchedEvents: string[];
  /** Player names with no NbaPlayer row (usually: hasn't played a logged game yet). */
  unmatchedPlayers: string[];
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

const LOOKAHEAD_HOURS = 36;
const ALLOWED = new Set<string>(ALLOWED_BOOK_KEYS);

/**
 * Pulls every NBA prop on the board and refreshes CurrentNbaPropLine for each
 * upcoming game the feed covers. ParlayAPI serves the whole slate in one ~3-credit
 * call; The Odds API takes one call per game (markets × regions credits each),
 * so it only covers games tipping within TOA_LOOKAHEAD_HOURS.
 */
export async function pollAndStoreNbaProps(now: Date = new Date()): Promise<PollNbaPropsSummary> {
  const summary: PollNbaPropsSummary = {
    status: "ok",
    gamesConsidered: 0,
    gamesStored: 0,
    rowsFetched: 0,
    quotesStored: 0,
    staleLinesRemoved: 0,
    skipped: { dfs: 0, noLine: 0, noPrice: 0, notAPlayer: 0, incoherent: 0, unmappedMarket: 0 },
    unmappedMarketKeys: {},
    unmatchedEvents: [],
    unmatchedPlayers: [],
    creditsUsed: null,
    creditsRemaining: null,
  };
  const provider = activeOddsProvider();

  const games = await prisma.game.findMany({
    where: {
      sport: "nba",
      status: "scheduled",
      scheduledStartUtc: { gte: now, lte: new Date(now.getTime() + LOOKAHEAD_HOURS * 3_600_000) },
    },
    orderBy: { scheduledStartUtc: "asc" },
    include: { homeTeam: true, awayTeam: true },
  });
  summary.gamesConsidered = games.length;
  if (games.length === 0) return { ...summary, status: "no-games" };

  let rows: ParlayPropRow[];
  if (provider === "parlay") {
    const bulk = await fetchBulkPlayerProps(NBA_LEAGUE.oddsSportKey);
    rows = bulk.rows;
    summary.creditsUsed = bulk.creditsUsed;
    summary.creditsRemaining = bulk.creditsRemaining;
  } else {
    // The Odds API: one call per game, against the event id the game-lines poll stored.
    rows = [];
    let used = 0;
    const cutoff = now.getTime() + TOA_LOOKAHEAD_HOURS * 3_600_000;
    for (const game of games) {
      if (!game.oddsApiEventId || game.scheduledStartUtc.getTime() > cutoff) continue;
      try {
        const res = await fetchEventPlayerProps(game.oddsApiEventId, TOA_NBA_PROP_MARKETS, TOA_PROP_REGIONS, NBA_LEAGUE.oddsSportKey);
        rows.push(...toaEventToPropRows(res.event));
        used += res.creditsUsed ?? 0;
        summary.creditsRemaining = res.creditsRemaining;
      } catch (error) {
        summary.unmatchedEvents.push(`${game.id}: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`);
      }
    }
    summary.creditsUsed = used;
  }
  summary.rowsFetched = rows.length;
  const grouped = groupNbaPropRows(rows);
  summary.skipped = grouped.skipped;
  summary.unmappedMarketKeys = grouped.unmappedMarketKeys;

  // Bind feed events to games by allowlisted team names — both sides required,
  // the earliest game winning if a pair somehow appears twice in the window.
  const quotesByGame = new Map<string, NbaPropQuote[]>();
  for (const [eventId, event] of grouped.events) {
    const home = NBA_LEAGUE.lookupTeam(event.homeTeam);
    const away = NBA_LEAGUE.lookupTeam(event.awayTeam);
    const game = games.find((g) => g.homeTeam?.name === home?.name && g.awayTeam?.name === away?.name);
    if (!home || !away || !game) {
      summary.unmatchedEvents.push(`${event.awayTeam} @ ${event.homeTeam} (${eventId})`);
      continue;
    }
    quotesByGame.set(game.id, [...(quotesByGame.get(game.id) ?? []), ...event.quotes]);
  }

  const index = buildNbaPlayerIndex(await prisma.nbaPlayer.findMany({ select: { id: true, fullName: true } }));
  const unmatchedPlayers = new Set<string>();
  const polledAt = new Date();
  const booksSeen = new Map<string, string>();

  for (const [gameId, quotes] of quotesByGame) {
    const rows: {
      gameId: string;
      nbaPlayerId: string;
      bookKey: string;
      stat: NbaPropStat;
      side: Side;
      point: number;
      priceAmerican: number;
      polledAt: Date;
    }[] = [];
    for (const q of quotes) {
      if (!ALLOWED.has(q.bookKey) || !Number.isFinite(q.priceAmerican)) continue;
      const nbaPlayerId = lookupNbaPlayer(index, q.player);
      if (!nbaPlayerId) {
        unmatchedPlayers.add(q.player);
        continue;
      }
      booksSeen.set(q.bookKey, q.bookTitle);
      rows.push({ gameId, nbaPlayerId, bookKey: q.bookKey, stat: q.stat, side: q.side, point: q.point, priceAmerican: q.priceAmerican, polledAt });
    }
    if (rows.length === 0) continue;

    for (const [key, title] of booksSeen) {
      await prisma.sportsbook.upsert({
        where: { key },
        create: { key, displayName: title, region: "us" },
        update: {},
      });
    }
    booksSeen.clear();

    await prisma.nbaPropSnapshot.createMany({ data: rows });
    for (const row of rows) {
      const { priceAmerican, ...key } = row;
      await prisma.currentNbaPropLine.upsert({
        where: {
          gameId_nbaPlayerId_bookKey_stat_side_point: {
            gameId: key.gameId,
            nbaPlayerId: key.nbaPlayerId,
            bookKey: key.bookKey,
            stat: key.stat,
            side: key.side,
            point: key.point,
          },
        },
        create: row,
        update: { priceAmerican, polledAt },
      });
    }
    // Anything this poll didn't refresh is a line the books took down or moved.
    const removed = await prisma.currentNbaPropLine.deleteMany({ where: { gameId, polledAt: { lt: polledAt } } });
    summary.staleLinesRemoved += removed.count;
    summary.quotesStored += rows.length;
    summary.gamesStored++;
  }

  summary.unmatchedPlayers = [...unmatchedPlayers].sort();
  return summary;
}
