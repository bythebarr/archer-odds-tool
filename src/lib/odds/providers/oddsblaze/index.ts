/**
 * OddsBlaze provider — public surface.
 *
 * `fetchOddsBlazeGameOdds` is the drop-in analogue of oddsApiClient's `fetchOdds`:
 * it returns a `FetchOddsResult` an ingest can hand straight to `storeBookmakerOdds`.
 * The difference is what happens inside — OddsBlaze serves one book per request, so
 * this fans out across the request-book list and merges, where `fetchOdds` is a
 * single call.
 */
import {
  fetchOddsBlazeBookOdds,
  type OddsBlazeOddsResponse,
} from "./client";
import {
  normalizeOddsBlazeOdds,
  gameLineMarketNames,
  supportsLeague,
  type OddsBlazeNormalizedEvent,
} from "./normalize";
import { ODDSBLAZE_REQUEST_BOOKS } from "./books";
import type { FetchOddsResult } from "@/lib/odds/oddsApiClient";

export interface FetchOddsBlazeResult extends FetchOddsResult {
  events: OddsBlazeNormalizedEvent[];
}

/**
 * Current game-line odds for a league across the request-book list, normalized to
 * our internal shape.
 *
 * Poll cost: OddsBlaze meters PER REQUEST and one request is one book, so a poll
 * costs `books.length` credit units — and, unlike TOA/Parlay, that cost is NOT
 * readable from a response header (none is sent), so `creditsUsed` is the count of
 * requests we made, not a figure the provider confirmed. This is the number to
 * weigh against the account allotment before flipping a sport onto OddsBlaze; trim
 * `books` (see ODDSBLAZE_REQUEST_BOOKS) to cut it.
 *
 * A book that 404s (doesn't cover the league) is skipped silently — that's a
 * coverage fact, not a failure.
 */
export async function fetchOddsBlazeGameOdds(
  league: string,
  {
    books = ODDSBLAZE_REQUEST_BOOKS,
    skipLive = true,
    alternates = true,
  }: { books?: readonly string[]; skipLive?: boolean; alternates?: boolean } = {}
): Promise<FetchOddsBlazeResult> {
  if (!supportsLeague(league)) {
    throw new Error(`OddsBlaze: league '${league}' has no game-line market map yet — see normalize.ts`);
  }

  const marketNames = gameLineMarketNames(league);
  const responses: OddsBlazeOddsResponse[] = [];
  // Sequential rather than Promise.all: it's a handful of books and keeping the
  // requests serial avoids a burst against an unknown rate limit. Latency here is
  // a background poll, not a user request.
  //
  // We do NOT pass main=true when alternates are wanted: OddsBlaze returns the full
  // ladder (main + alt) in the one request either way, so dropping the filter costs
  // nothing extra and buys every rung. The main-only server filter is only used
  // when a caller explicitly opts out of alts.
  for (const book of books) {
    const res = await fetchOddsBlazeBookOdds(league, book, {
      markets: marketNames,
      mainOnly: !alternates,
    });
    if (res) responses.push(res);
  }

  const events = normalizeOddsBlazeOdds(league, responses, { skipLive, alternates });

  return {
    events,
    creditsUsed: books.length, // requests attempted = credit units spent (no header to confirm)
    creditsRemaining: null,
  };
}

export type { OddsBlazeNormalizedEvent } from "./normalize";
export {
  fetchOddsBlazeSchedule,
  fetchOddsBlazeGrade,
  type OddsBlazeGradeResult,
  type OddsBlazeScheduleResponse,
} from "./client";
