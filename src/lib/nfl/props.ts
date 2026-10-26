/**
 * NFL player-prop odds: the NBA ingest (src/lib/nba/props.ts) for football.
 * ParlayAPI's bulk endpoint gives the whole slate in one call; The Odds API takes
 * one call per game. Rows are bound to our games by team names, players by
 * normalized name, and stored as snapshots plus the current-line table.
 *
 * Anytime TD is a Yes/No market with no line: it's stored as Over/Under 0.5
 * touchdowns, so it rides the same two-sided machinery (fair price, EV, splits).
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
import { looksLikePlayerName } from "@/lib/props/propMarkets";
import { buildNbaPlayerIndex as buildPlayerIndex, lookupNbaPlayer as lookupPlayer } from "@/lib/nba/props";
import type { NflPropStat, Side } from "@/generated/prisma/client";
import { NFL_LEAGUE } from "./league";
import { NFL_MARKET_KEY_TO_STAT } from "./propStats";

export interface NflPropQuote {
  bookKey: string;
  bookTitle: string;
  player: string;
  stat: NflPropStat;
  side: Side;
  point: number;
  priceAmerican: number;
}

const ANYTIME_POINT = 0.5;

/** Groups flat rows by feed event into per-side quotes, dropping DFS rows, unmapped markets and non-player names. */
export function groupNflPropRows(rows: ParlayPropRow[]) {
  const events = new Map<string, { homeTeam: string; awayTeam: string; quotes: NflPropQuote[] }>();
  const unmappedMarketKeys: Record<string, number> = {};
  let skipped = 0;
  for (const row of rows) {
    const stat = NFL_MARKET_KEY_TO_STAT[row.market_key];
    if (!stat) {
      unmappedMarketKeys[row.market_key] = (unmappedMarketKeys[row.market_key] ?? 0) + 1;
      continue;
    }
    const point = stat === "anytimeTd" ? ANYTIME_POINT : row.line;
    if (row.is_dfs_flat_payout || point == null || point < 0 || !looksLikePlayerName(row.player)) {
      skipped++;
      continue;
    }
    const event = events.get(row.event_id) ?? { homeTeam: row.home_team, awayTeam: row.away_team, quotes: [] };
    events.set(row.event_id, event);
    const base = { bookKey: row.bookmaker, bookTitle: row.bookmaker_title, player: row.player.trim(), stat, point };
    if (row.over_price != null) event.quotes.push({ ...base, side: "over", priceAmerican: row.over_price });
    if (row.under_price != null) event.quotes.push({ ...base, side: "under", priceAmerican: row.under_price });
  }
  return { events, unmappedMarketKeys, skipped };
}

/**
 * The Odds API's per-event props as flat rows. Over/Under outcomes pair by
 * player and line; an anytime-TD "Yes"/"No" pair becomes Over/Under 0.5.
 */
export function toaNflEventToPropRows(event: OddsApiEvent): ParlayPropRow[] {
  const rows = new Map<string, ParlayPropRow>();
  for (const book of event.bookmakers ?? []) {
    for (const market of book.markets ?? []) {
      for (const o of market.outcomes ?? []) {
        const name = o.name.toLowerCase();
        const side = name === "over" || name === "yes" ? "over" : name === "under" || name === "no" ? "under" : null;
        if (!o.description || !side) continue;
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

/** The Odds API's NFL prop markets we map; billed per market returned, per region, per game. */
export const TOA_NFL_PROP_MARKETS = [
  "player_pass_yds",
  "player_pass_tds",
  "player_pass_completions",
  "player_pass_attempts",
  "player_pass_interceptions",
  "player_rush_yds",
  "player_rush_attempts",
  "player_receptions",
  "player_reception_yds",
  "player_rush_reception_yds",
  "player_anytime_td",
];
const TOA_PROP_REGIONS = ["us", "us2"];
/** Props post a day or two ahead; 30 hours covers a Sunday slate from Saturday's evening poll. */
const LOOKAHEAD_HOURS = 30;
const ALLOWED = new Set<string>(ALLOWED_BOOK_KEYS);

export interface PollNflPropsSummary {
  gamesConsidered: number;
  gamesStored: number;
  rowsFetched: number;
  quotesStored: number;
  staleLinesRemoved: number;
  skipped: number;
  unmappedMarketKeys: Record<string, number>;
  unmatchedEvents: string[];
  unmatchedPlayers: string[];
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

export async function pollAndStoreNflProps(now: Date = new Date()): Promise<PollNflPropsSummary> {
  const summary: PollNflPropsSummary = {
    gamesConsidered: 0,
    gamesStored: 0,
    rowsFetched: 0,
    quotesStored: 0,
    staleLinesRemoved: 0,
    skipped: 0,
    unmappedMarketKeys: {},
    unmatchedEvents: [],
    unmatchedPlayers: [],
    creditsUsed: null,
    creditsRemaining: null,
  };
  const games = await prisma.game.findMany({
    where: { sport: "nfl", status: "scheduled", scheduledStartUtc: { gte: now, lte: new Date(now.getTime() + LOOKAHEAD_HOURS * 3_600_000) } },
    orderBy: { scheduledStartUtc: "asc" },
    include: { homeTeam: true, awayTeam: true },
  });
  summary.gamesConsidered = games.length;
  if (games.length === 0) return summary;

  let rows: ParlayPropRow[] = [];
  if (activeOddsProvider() === "parlay") {
    const bulk = await fetchBulkPlayerProps(NFL_LEAGUE.oddsSportKey);
    rows = bulk.rows;
    summary.creditsUsed = bulk.creditsUsed;
    summary.creditsRemaining = bulk.creditsRemaining;
  } else {
    let used = 0;
    for (const game of games) {
      if (!game.oddsApiEventId) continue;
      try {
        const res = await fetchEventPlayerProps(game.oddsApiEventId, TOA_NFL_PROP_MARKETS, TOA_PROP_REGIONS, NFL_LEAGUE.oddsSportKey);
        rows.push(...toaNflEventToPropRows(res.event));
        used += res.creditsUsed ?? 0;
        summary.creditsRemaining = res.creditsRemaining;
      } catch (error) {
        summary.unmatchedEvents.push(`${game.id}: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`);
      }
    }
    summary.creditsUsed = used;
  }
  summary.rowsFetched = rows.length;
  const grouped = groupNflPropRows(rows);
  summary.skipped = grouped.skipped;
  summary.unmappedMarketKeys = grouped.unmappedMarketKeys;

  const quotesByGame = new Map<string, NflPropQuote[]>();
  for (const [eventId, event] of grouped.events) {
    const home = NFL_LEAGUE.lookupTeam(event.homeTeam);
    const away = NFL_LEAGUE.lookupTeam(event.awayTeam);
    const game = games.find((g) => g.homeTeam?.name === home?.name && g.awayTeam?.name === away?.name);
    if (!home || !away || !game) {
      summary.unmatchedEvents.push(`${event.awayTeam} @ ${event.homeTeam} (${eventId})`);
      continue;
    }
    quotesByGame.set(game.id, [...(quotesByGame.get(game.id) ?? []), ...event.quotes]);
  }

  const index = buildPlayerIndex(await prisma.nflPlayer.findMany({ select: { id: true, fullName: true } }));
  const unmatched = new Set<string>();
  const polledAt = new Date();

  for (const [gameId, quotes] of quotesByGame) {
    const data: { gameId: string; nflPlayerId: string; bookKey: string; stat: NflPropStat; side: Side; point: number; priceAmerican: number; polledAt: Date }[] = [];
    const books = new Map<string, string>();
    for (const q of quotes) {
      if (!ALLOWED.has(q.bookKey) || !Number.isFinite(q.priceAmerican)) continue;
      const nflPlayerId = lookupPlayer(index, q.player);
      if (!nflPlayerId) {
        unmatched.add(q.player);
        continue;
      }
      books.set(q.bookKey, q.bookTitle);
      data.push({ gameId, nflPlayerId, bookKey: q.bookKey, stat: q.stat, side: q.side, point: q.point, priceAmerican: q.priceAmerican, polledAt });
    }
    if (data.length === 0) continue;
    for (const [key, title] of books) {
      await prisma.sportsbook.upsert({ where: { key }, create: { key, displayName: title, region: "us" }, update: {} });
    }
    await prisma.nflPropSnapshot.createMany({ data });
    for (const row of data) {
      const { priceAmerican, ...key } = row;
      await prisma.currentNflPropLine.upsert({
        where: {
          gameId_nflPlayerId_bookKey_stat_side_point: {
            gameId: key.gameId,
            nflPlayerId: key.nflPlayerId,
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
    summary.staleLinesRemoved += (await prisma.currentNflPropLine.deleteMany({ where: { gameId, polledAt: { lt: polledAt } } })).count;
    summary.quotesStored += data.length;
    summary.gamesStored++;
  }
  summary.unmatchedPlayers = [...unmatched].sort();
  return summary;
}
