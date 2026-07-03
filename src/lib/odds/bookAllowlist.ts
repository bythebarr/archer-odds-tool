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

/** Short fallback label shown in place of a book's logo until one is provided (see public/logos/books/README.md). */
export const BOOK_INITIALS: Record<string, string> = {
  draftkings: "DK",
  fanduel: "FD",
  betmgm: "MGM",
  williamhill_us: "CZR",
  betrivers: "BR",
  espnbet: "ESPN",
};

/** Approximate brand color per book, used for the same fallback badge — not an official asset. */
export const BOOK_COLORS: Record<string, string> = {
  draftkings: "#53D337",
  fanduel: "#1493FF",
  betmgm: "#B4975A",
  williamhill_us: "#B7963C",
  betrivers: "#00529B",
  espnbet: "#D00000",
};
