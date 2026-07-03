/**
 * US-legal regulated sportsbooks we show. The Odds API is the source of truth
 * for the exact key/display-title pairing (see poll-odds ingestion) — this is
 * just the filter deciding which of the books in their response we keep.
 * `espnbet` lives in Odds API region `us2` (see fetchMlbOdds's regions param,
 * which must request it for espnbet to come back at all).
 *
 * Caesars (`williamhill_us`) and Fanatics (`fanatics`) are deliberately NOT
 * listed — both are gated behind a paid Odds API plan and are silently
 * omitted from every response on the free tier, regardless of the `regions`
 * param. Add them back once/if the plan is upgraded.
 */
export const ALLOWED_BOOK_KEYS = [
  "draftkings",
  "fanduel",
  "betmgm",
  "betrivers",
  "espnbet",
] as const;

/** Short fallback label shown in place of a book's logo until one is provided (see public/logos/books/README.md). */
export const BOOK_INITIALS: Record<string, string> = {
  draftkings: "DK",
  fanduel: "FD",
  betmgm: "MGM",
  betrivers: "BR",
  espnbet: "ESPN",
};

/** Approximate brand color per book, used for the same fallback badge — not an official asset. */
export const BOOK_COLORS: Record<string, string> = {
  draftkings: "#53D337",
  fanduel: "#1493FF",
  betmgm: "#B4975A",
  betrivers: "#00529B",
  espnbet: "#D00000",
};
