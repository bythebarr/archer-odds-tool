/**
 * Odds provider. ParlayAPI is deliberately URL- and shape-compatible with The
 * Odds API on the endpoints we use — same paths, same `?apiKey=`, and (verified
 * against live responses) the same JSON for game lines AND scores — so the
 * provider is a base-URL + key swap rather than an integration.
 *
 * Why we moved: TOA carries no sharp book, so our de-vigged "fair price" was a
 * consensus of recreational books. ParlayAPI carries **Pinnacle**, which is the
 * closest thing to a true market price — that upgrades both the fair-value
 * baseline and any honest CLV measurement.
 *
 * `ODDS_PROVIDER` forces a choice; otherwise we prefer Parlay when its key is
 * present and fall back to TOA, so the switch is reversible by unsetting one
 * env var rather than a deploy.
 *
 * NOT compatible: player props. Parlay returns flat per-book rows rather than
 * TOA's nested bookmakers→markets→outcomes, so pollPlayerProps still needs its
 * own mapping — see fetchEventPlayerProps below.
 */
type OddsProvider = "parlay" | "toa";

const PROVIDER: OddsProvider =
  (process.env.ODDS_PROVIDER as OddsProvider | undefined) ??
  (process.env.PARLAY_API_KEY ? "parlay" : "toa");

const BASE_URL =
  PROVIDER === "parlay" ? "https://parlay-api.com/v1" : "https://api.the-odds-api.com/v4";

/** The key for whichever provider is active. */
function oddsApiKey(): string {
  const key = PROVIDER === "parlay" ? process.env.PARLAY_API_KEY : process.env.ODDS_API_KEY;
  if (!key) {
    throw new Error(
      PROVIDER === "parlay" ? "PARLAY_API_KEY is not set" : "ODDS_API_KEY is not set"
    );
  }
  return key;
}

export function activeOddsProvider(): OddsProvider {
  return PROVIDER;
}
const MLB_SPORT_KEY = "baseball_mlb";

export type OddsApiMarketKey =
  | "h2h"
  | "spreads"
  | "totals"
  | "alternate_spreads"
  | "alternate_totals";

/**
 * NOTE the nullable price: ParlayAPI returns `price: null` for a suspended or
 * pulled market where TOA omitted the outcome entirely. Callers must guard —
 * see storeOdds, which skips them rather than storing an unusable row.
 */
export interface OddsApiOutcome {
  name: string; // team name for h2h/spreads; "Over"/"Under" for totals and player props
  /** American odds. NULLABLE: a suspended/pulled market comes back priceless. */
  price: number | null;
  point?: number;
  // Present on player-prop outcomes only: the player's full name. Confirmed
  // live against a real per-event player-props response — see propMarkets.ts.
  description?: string;
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
  const apiKey = oddsApiKey();

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

const UFC_SPORT_KEY = "mma_mixed_martial_arts";

/**
 * Fetches current UFC/MMA moneyline (h2h) odds across US regions. us2 is
 * required for espnbet, same as MLB (see fetchMlbOdds). The Odds API only
 * exposes h2h + totals for MMA — method-of-victory / round / distance props
 * are rejected with INVALID_MARKET (confirmed live) — so phase 1 requests
 * h2h only. The MMA feed mixes promotions (UFC + regional cards); callers
 * match events to our ingested UFC bouts and drop the rest.
 */
export async function fetchUfcOdds(): Promise<FetchOddsResult> {
  return fetchOdds(UFC_SPORT_KEY, ["h2h"], ["us", "us2"]);
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
  const apiKey = oddsApiKey();

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
  const apiKey = oddsApiKey();

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

/**
 * Fetches player-prop odds for ONE MLB game via the per-event endpoint —
 * the only place The Odds API serves props, same as alt lines. Costs
 * `markets.length * regions.length` credits per game. Market keys are plain
 * strings here (not OddsApiMarketKey) since prop markets are a completely
 * different key namespace (batter_hits, pitcher_strikeouts, etc.) that
 * storeOdds.ts's game-line parsing has no notion of — see
 * propMarkets.ts/storePropOdds.ts for the props-specific mapping and parsing.
 */
export async function fetchEventPlayerProps(
  eventId: string,
  markets: string[],
  regions: string[]
): Promise<FetchEventOddsResult> {
  const apiKey = oddsApiKey();

  const url = new URL(`${BASE_URL}/sports/${MLB_SPORT_KEY}/events/${eventId}/odds`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("regions", regions.join(","));
  url.searchParams.set("markets", markets.join(","));
  url.searchParams.set("oddsFormat", "american");
  url.searchParams.set("dateFormat", "iso");

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`The Odds API player-props request failed: ${res.status} ${res.statusText} — ${body}`);
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
  const apiKey = oddsApiKey();

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
