/**
 * OddsBlaze sportsbook ids ↔ our canonical book keys.
 *
 * Two feeds, two spellings for the same book: OddsBlaze says `hard-rock` where we
 * store `hardrock`, `betparx` where we store `parx`. This map is the single place
 * that reconciles them, so the rest of the pipeline (bookAllowlist, best-price,
 * display) never learns OddsBlaze exists.
 *
 * We only list books that have a canonical equivalent AND that we'd keep. Whether
 * a mapped book is actually persisted is still decided downstream by
 * ALLOWED_BOOK_KEYS in bookAllowlist.ts — this map only translates spelling, it
 * does not grant admission. Keeping those two jobs separate means the "which books
 * do we trust" decision stays in one file for every provider, not smuggled in here.
 *
 * Deliberately NOT mapped (so they're dropped at the fan-out, never even fetched):
 *   • Exchanges / prediction markets — kalshi, polymarket, polymarket-us, and now
 *     novig, prophetx too (removed 2026-07-22 by owner call, matching bookAllowlist).
 *     Not mapping them here means we don't even spend a request fetching a book
 *     we'd discard downstream; if the call reverses, re-add here AND in bookAllowlist.
 *   • DFS pick-em — prizepicks(+demons/goblins), prop-builder, payday-fantasy,
 *     splash-sports: pick-em payouts aren't real two-way prices.
 *   • Offshore / regional dupes we don't send members to — bovada, betonline,
 *     bwin, fliff, thescore, sports-interaction, betmgm-michigan, hard-rock state
 *     variants.
 *
 * Absent from OddsBlaze entirely (so they simply won't appear on an OddsBlaze
 * board, by design not omission): fanduel, espnbet, pinnacle.
 */

/** OddsBlaze sportsbook id → our canonical book key. */
export const ODDSBLAZE_BOOK_KEY_MAP: Record<string, string> = {
  draftkings: "draftkings",
  betmgm: "betmgm",
  betrivers: "betrivers",
  caesars: "caesars",
  fanatics: "fanatics",
  bet365: "bet365",
  "hard-rock": "hardrock",
  betparx: "parx",
};

/**
 * The OddsBlaze sportsbook ids we actually request, in a stable order.
 *
 * This is the fan-out list: OddsBlaze serves one book per request, so a game-lines
 * poll is exactly this many HTTP calls (and, since OddsBlaze meters by request,
 * this many credit units). Trimming this list is the lever for the credit-vs-
 * coverage trade — see the poll cost note in index.ts.
 */
export const ODDSBLAZE_REQUEST_BOOKS: readonly string[] = Object.keys(ODDSBLAZE_BOOK_KEY_MAP);

/** Translate an OddsBlaze sportsbook id to our canonical key, or null to drop it. */
export function canonicalBookKey(oddsBlazeId: string): string | null {
  return ODDSBLAZE_BOOK_KEY_MAP[oddsBlazeId] ?? null;
}
