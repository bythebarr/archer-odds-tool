const BASE_URL = "https://api.the-odds-api.com/v4";
const MLB_SPORT_KEY = "baseball_mlb";

export type OddsApiMarketKey = "h2h" | "spreads" | "totals";

export interface OddsApiOutcome {
  name: string; // team name for h2h/spreads; "Over"/"Under" for totals
  price: number; // American odds (we always request oddsFormat=american)
  point?: number;
}

export interface OddsApiMarket {
  key: OddsApiMarketKey;
  outcomes: OddsApiOutcome[];
}

export interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;
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

export interface FetchMlbOddsResult {
  events: OddsApiEvent[];
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

/**
 * Fetches current MLB odds across the given markets, US region only.
 * Costs `markets.length` credits per The Odds API's quota formula
 * (regions=us is a single region) — see plan doc for the cost model.
 */
export async function fetchMlbOdds(
  markets: OddsApiMarketKey[] = ["h2h", "spreads", "totals"]
): Promise<FetchMlbOddsResult> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    throw new Error("ODDS_API_KEY is not set");
  }

  const url = new URL(`${BASE_URL}/sports/${MLB_SPORT_KEY}/odds`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("regions", "us");
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

function parseIntHeader(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}
