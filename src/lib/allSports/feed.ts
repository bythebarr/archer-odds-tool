/**
 * The all-sports engine reads any odds feed through this one shape, so The Odds
 * API (and its Parlay twin) and odds-api.io are interchangeable — and a third
 * feed is one adapter, not a rewrite.
 *
 * Every price comes out American; every side comes out as home / away / draw /
 * over / under / yes / no, or a competitor's name for futures.
 */
import type { ProviderLeagueRef } from "./sports";

export type FeedId = "toa" | "oddsapiio";

export interface FeedLeague {
  providerKey: string;
  ref: ProviderLeagueRef;
  /** The feed's own title, used when the league directory doesn't know it. */
  title: string;
  region: string | null;
  outright: boolean;
}

export type FeedEventStatus = "scheduled" | "live" | "final" | "cancelled";

export interface FeedEvent {
  /** The feed's own event id. */
  id: string;
  providerKey: string;
  startsAt: Date;
  home: string;
  away: string;
  homeRef?: string | null;
  awayRef?: string | null;
  status: FeedEventStatus;
  homeScore?: number | null;
  awayScore?: number | null;
  periods?: Record<string, { home: number; away: number }> | null;
}

export interface FeedLine {
  eventId: string;
  bookKey: string;
  /** "ml" | "spread" | "total" | "btts" | "dnb" | "outright" */
  market: string;
  period: string;
  side: string;
  point: number;
  priceAmerican: number;
}

export interface FeedOdds {
  events: FeedEvent[];
  lines: FeedLine[];
  /** What the call cost in the feed's own unit (credits on TOA, requests on odds-api.io). */
  cost: number;
  remaining: number | null;
}

export interface AllSportsFeed {
  id: FeedId;
  /** Every league in season. Free (TOA) or one request per sport (odds-api.io). */
  listLeagues(): Promise<FeedLeague[]>;
  /** Upcoming events per league, without odds. Free on TOA. */
  listEvents(leagues: FeedLeague[]): Promise<Map<string, FeedEvent[]>>;
  /** Odds for a league's upcoming events (the ids limit it where the feed allows). */
  fetchOdds(league: FeedLeague, eventIds: string[]): Promise<FeedOdds>;
  /** Recently finished events with their scores. */
  fetchResults(league: FeedLeague): Promise<{ events: FeedEvent[]; cost: number }>;
}

/** Decimal → American, rounded; null for a price that can't be right. */
export function decimalToAmericanPrice(decimal: number): number | null {
  if (!Number.isFinite(decimal) || decimal <= 1.001) return null;
  const a = decimal >= 2 ? (decimal - 1) * 100 : -100 / (decimal - 1);
  return Math.round(a);
}
