const BASE_URL = "https://api.the-odds-api.com/v4";
const MLB_SPORT_KEY = "baseball_mlb";

export type OddsApiMarketKey =
  | "h2h"
  | "spreads"
  | "totals"
  | "alternate_spreads"
  | "alternate_totals";

export interface OddsApiOutcome {
  name: string; // team name for h2h/spreads; "Over"/"Under" for totals
  price: number; // American odds (we always request oddsFormat=american)
  point?: number;
}

export interface OddsApiMarket {
  key: OddsApiMarketKey;
  // Present per-market on the per-event endpoint; the bulk endpoint instead
  // puts this on the bookmaker itself (see OddsApiBookmaker.last_update).
  last_update?: string;
  outcomes: OddsApiOutcome[];
}

export interface OddsApiBookmaker {
  key: string;
  title: string;
  // Present on the bulk /odds endpoint; absent on the per-event endpoint,
  // which puts last_update on each market instead. Consumers should prefer
  // market.last_update and fall back to this.
  last_update?: string;
  markets: OddsApiMarket[];
}

export interface OddsApiEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

export interface FetchOddsResult {
  events: OddsApiEvent[];
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

/** @deprecated kept as an alias for existing MLB call sites; use FetchOddsResult for new code. */
export type FetchMlbOddsResult = FetchOddsResult;

/**
 * Fetches current odds for any sport_key across the given markets/regions.
 * Costs `markets.length * regions.length` credits per The Odds API's quota
 * formula, regardless of event count — shared by every sport's odds poller.
 * See tennis/ingest.ts for the tennis caller; fetchMlbOdds below is a thin
 * MLB-specific wrapper over this, unchanged in behavior.
 */
export async function fetchOdds(
  sportKey: string,
  markets: OddsApiMarketKey[],
  regions: string[]
): Promise<FetchOddsResult> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    throw new Error("ODDS_API_KEY is not set");
  }

  const url = new URL(`${BASE_URL}/sports/${sportKey}/odds`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("regions", regions.join(","));
  url.searchParams.set("markets", markets.join(","));
  url.searchParams.set("oddsFormat", "american");
  url.searchParams.set("dateFormat", "iso");

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`The Odds API request failed: ${res.status} ${res.statusText} — ${body}`);
  }

  const events = (await res.json()) as OddsApiEvent[];

  return {
    events,
    creditsUsed: parseIntHeader(res.headers.get("x-requests-last")),
    creditsRemaining: parseIntHeader(res.headers.get("x-requests-remaining")),
  };
}

/**
 * Fetches current MLB odds across the given markets and US regions.
 * us2 is required for espnbet, which lives outside the base us region (the
 * rest of ALLOWED_BOOK_KEYS is covered by us; Caesars/Fanatics also live in
 * us but are paid-tier gated — see bookAllowlist.ts).
 *
 * alternate_spreads/alternate_totals are NOT valid here — The Odds API
 * rejects them with INVALID_MARKET on this bulk endpoint ("featured markets"
 * only). They're only available one event at a time, via
 * fetchEventAlternateOdds below.
 */
export async function fetchMlbOdds(
  markets: OddsApiMarketKey[] = ["h2h", "spreads", "totals"]
): Promise<FetchMlbOddsResult> {
  return fetchOdds(MLB_SPORT_KEY, markets, ["us", "us2"]);
}

export interface OddsApiSport {
  key: string;
  group: string;
  title: string;
  description: string;
  active: boolean;
  has_outrights: boolean;
}

/**
 * Lists every sport_key The Odds API knows about, including whether it's
 * currently active — e.g. tennis tournaments only show `active: true` while
 * the tournament is actually running. Free: does not count against the
 * usage quota (confirmed via docs and a live call this session).
 */
export async function fetchSportsList(): Promise<OddsApiSport[]> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    throw new Error("ODDS_API_KEY is not set");
  }

  const url = new URL(`${BASE_URL}/sports`);
  url.searchParams.set("apiKey", apiKey);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`The Odds API sports-list request failed: ${res.status} ${res.statusText} — ${body}`);
  }

  return (await res.json()) as OddsApiSport[];
}

export interface FetchEventOddsResult {
  event: OddsApiEvent;
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

/**
 * Fetches alternate spreads/totals for ONE game via the per-event endpoint —
 * the only place The Odds API serves "non-featured" markets. Costs
 * `markets.length * regions.length` credits same as the bulk formula, but
 * per game: 2 markets x 2 regions = 4 credits for one game's alt lines.
 * Call sparingly (see IMMINENT_THRESHOLD_MINUTES in pollingPolicy.ts).
 */
export async function fetchEventAlternateOdds(
  eventId: string,
  markets: OddsApiMarketKey[] = ["alternate_spreads", "alternate_totals"]
): Promise<FetchEventOddsResult> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    throw new Error("ODDS_API_KEY is not set");
  }

  const url = new URL(`${BASE_URL}/sports/${MLB_SPORT_KEY}/events/${eventId}/odds`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("regions", "us,us2");
  url.searchParams.set("markets", markets.join(","));
  url.searchParams.set("oddsFormat", "american");
  url.searchParams.set("dateFormat", "iso");

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`The Odds API event-odds request failed: ${res.status} ${res.statusText} — ${body}`);
  }

  const event = (await res.json()) as OddsApiEvent;

  return {
    event,
    creditsUsed: parseIntHeader(res.headers.get("x-requests-last")),
    creditsRemaining: parseIntHeader(res.headers.get("x-requests-remaining")),
  };
}

export interface OddsApiScoreEntry {
  name: string;
  score: string;
}

export interface OddsApiScoreResult {
  id: string;
  sport_key: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: OddsApiScoreEntry[] | null;
  last_update: string | null;
}

export interface FetchScoresResult {
  results: OddsApiScoreResult[];
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

/**
 * Fetches recent/completed results for a sport_key. Costs a flat 2 credits
 * per call regardless of markets/regions (measured live this session — the
 * secondhand doc summary said 1 credit, that was wrong; see the tennis plan
 * doc). `daysFrom` (1-3) controls how far back completed events are
 * included. Coverage is sport-dependent — confirmed live for tennis this
 * session (returns real match data), but the exact shape of a *completed*
 * match's `scores` field is still unverified (zero completed matches seen
 * during a live tournament day) — see tennis/grading.ts's defensive parsing.
 */
export async function fetchScores(sportKey: string, daysFrom: number): Promise<FetchScoresResult> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    throw new Error("ODDS_API_KEY is not set");
  }

  const url = new URL(`${BASE_URL}/sports/${sportKey}/scores`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("daysFrom", String(daysFrom));
  url.searchParams.set("dateFormat", "iso");

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`The Odds API scores request failed: ${res.status} ${res.statusText} — ${body}`);
  }

  const results = (await res.json()) as OddsApiScoreResult[];

  return {
    results,
    creditsUsed: parseIntHeader(res.headers.get("x-requests-last")),
    creditsRemaining: parseIntHeader(res.headers.get("x-requests-remaining")),
  };
}

function parseIntHeader(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}
