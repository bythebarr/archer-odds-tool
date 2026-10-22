/**
 * Low-level OddsBlaze HTTP client. One function per endpoint, no mapping — the
 * raw shapes come out here and normalize.ts turns them into our internal model.
 *
 * OddsBlaze is NOT Odds-API-shaped (unlike ParlayAPI), so it can't share
 * oddsApiClient.ts's base-URL swap. Notable differences the callers must know:
 *   • Auth is a `?key=` query param, not `?apiKey=`.
 *   • Each subdomain is its own endpoint host: odds./schedule./grader./sportsbooks.
 *   • The /odds endpoint serves ONE sportsbook per request (fan-out lives in index.ts).
 *   • Prices are STRINGS ("-115", "+155") — parse before arithmetic.
 *   • No credit/usage headers are exposed on responses (checked live 2026-07-22),
 *     so per-poll cost can't be read back the way TOA/Parlay's x-requests-* are.
 *     Metering is per request; index.ts reports request count as the cost proxy.
 */

function oddsBlazeKey(): string {
  const key = process.env.ODDSBLAZE_API_KEY;
  if (!key) throw new Error("ODDSBLAZE_API_KEY is not set");
  return key;
}

// ---- raw response shapes (only the fields we consume are typed) ----

export interface OddsBlazeTeam {
  id: string;
  name: string;
  abbreviation: string;
}

export interface OddsBlazeSelection {
  /** Present on team-side markets (Moneyline/Run Line): the clean team name. */
  name?: string;
  /** Present on totals: "Over" | "Under". */
  side?: string;
  /** The line/point, when the market has one (Run Line, Total Runs). */
  line?: number;
}

export interface OddsBlazeOdd {
  /** Deterministic id "Book#event#market#name" — this is what the Grader grades. */
  id: string;
  market: string; // e.g. "Moneyline", "Run Line", "Total Runs"
  name: string; // display name, e.g. "New York Mets", "Over 4.5"
  price: string; // american odds AS A STRING
  main?: boolean;
  selection?: OddsBlazeSelection;
}

export interface OddsBlazeEvent {
  id: string;
  /** Cross-provider ids; mappings.MLB.id is the MLB Stats API gamePk. */
  mappings?: Record<string, { id: string }>;
  teams: { home: OddsBlazeTeam; away: OddsBlazeTeam };
  date: string; // ISO
  live?: boolean;
  odds?: OddsBlazeOdd[];
}

export interface OddsBlazeOddsResponse {
  updated?: string;
  league: string;
  /** The book this response is for — an object, NOT a bare string. */
  sportsbook: { id: string; name: string };
  events: OddsBlazeEvent[];
}

/**
 * Fetches one sportsbook's odds for a league. `markets` filters server-side by
 * OddsBlaze market NAME (e.g. "Moneyline") — pass the game-line names to avoid
 * pulling the full 700-row prop payload when only lines are wanted.
 *
 * Returns null on a 404, which OddsBlaze uses for "this book doesn't cover this
 * league" (e.g. bwin/sports-interaction have no MLB) — a normal, skippable
 * outcome, not an error worth aborting the whole fan-out over.
 */
export async function fetchOddsBlazeBookOdds(
  league: string,
  sportsbook: string,
  { markets, mainOnly }: { markets?: string[]; mainOnly?: boolean } = {}
): Promise<OddsBlazeOddsResponse | null> {
  const url = new URL("https://odds.oddsblaze.com/");
  url.searchParams.set("key", oddsBlazeKey());
  url.searchParams.set("sportsbook", sportsbook);
  url.searchParams.set("league", league);
  url.searchParams.set("price", "american");
  if (markets?.length) url.searchParams.set("market", markets.join(","));
  if (mainOnly) url.searchParams.set("main", "true");

  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `OddsBlaze odds ${res.status} for ${sportsbook}/${league}: ${(await res.text()).slice(0, 200)}`
    );
  }
  return (await res.json()) as OddsBlazeOddsResponse;
}
