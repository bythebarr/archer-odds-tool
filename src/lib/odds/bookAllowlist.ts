/**
 * US-legal regulated sportsbooks we show. The Odds API is the source of truth
 * for the exact key/display-title pairing (see poll-odds ingestion) — this is
 * just the filter deciding which of the books in their response we keep.
 * `williamhill_us` is Caesars' key in the Odds API's `us` region.
 */
export const ALLOWED_BOOK_KEYS = [
  "draftkings",
  "fanduel",
  "betmgm",
  "williamhill_us", // Caesars
  "betrivers",
  "espnbet",
] as const;
