/**
 * Which books we keep, and which we'd actually send someone to.
 *
 * Two lists, because they answer different questions:
 *
 *   • BETTABLE_BOOK_KEYS — books a member can realistically bet at. This is the
 *     line-shopping set: "best price" is chosen from here, and only from here.
 *   • SHARP_BOOK_KEYS — books used to PRICE, never recommended. Pinnacle is the
 *     sharpest market there is, but US retail bettors mostly can't use it, so
 *     surfacing it as "best book" would be advice nobody can act on.
 *
 * Both are stored (ALLOWED_BOOK_KEYS), because storage feeds the de-vigged
 * consensus — and anchoring that consensus on a sharp book is the single
 * biggest accuracy win in the ParlayAPI switch. Best-price selection filters to
 * BETTABLE separately (see oddsPool).
 */

/** Books we'll point a member at. */
export const BETTABLE_BOOK_KEYS = [
  "draftkings",
  "fanduel",
  "betmgm",
  "betrivers",
  "espnbet",
  // Added with ParlayAPI — The Odds API's free tier silently omitted several of
  // these regardless of the regions requested, which is why they were missing.
  "caesars",
  "fanatics",
  "bet365",
  "hardrock",
  "parx",
  // NOTE: the peer-to-peer EXCHANGES (novig, prophetx) were removed 2026-07-22 by
  // owner call — they, like the prediction markets, had been distorting the board.
  // They're coherent near-zero-vig two-way markets, but they're out on preference,
  // not data. Re-add here (one line each) to reverse; the allowlist is the single
  // switch, so it applies to every provider at once.
] as const;

/**
 * Priced from, never recommended.
 *
 * Deliberately NOT in BETTABLE: Pinnacle isn't available to most US retail
 * bettors, so it belongs in the fair-value baseline rather than in "go get this
 * number at...".
 */
export const SHARP_BOOK_KEYS = ["pinnacle"] as const;

/**
 * Everything we persist. Storage feeds the de-vig consensus, so the sharp book
 * is kept even though it's never offered as a price to go and take.
 *
 * NOT included, on purpose:
 *   • bovada — offshore and unregulated; not somewhere to send paying members.
 *   • kalshi — its quotes came back incoherent in the live feed (both sides
 *     positive, e.g. +4900/+133, implying ~40% total). That's a thin order book,
 *     not a two-way market, and a stray +4900 would read as an enormous edge and
 *     manufacture fantasy EV.
 *   • prediction markets / exchanges in general — excluded by owner preference
 *     (2026-07-22): even the coherent ones (novig, prophetx) were muddying the
 *     board, so the whole category stays off, sportsbooks only.
 */
export const ALLOWED_BOOK_KEYS = [...BETTABLE_BOOK_KEYS, ...SHARP_BOOK_KEYS] as const;

/** Short fallback label shown in place of a book's logo until one is provided (see public/logos/books/README.md). */
export const BOOK_INITIALS: Record<string, string> = {
  draftkings: "DK",
  fanduel: "FD",
  betmgm: "MGM",
  betrivers: "BR",
  espnbet: "ESPN",
  caesars: "CZR",
  fanatics: "FAN",
  bet365: "365",
  hardrock: "HR",
  parx: "PARX",
  pinnacle: "PIN",
};

/** Approximate brand color per book, used for the same fallback badge — not an official asset. */
export const BOOK_COLORS: Record<string, string> = {
  draftkings: "#53D337",
  fanduel: "#1493FF",
  betmgm: "#B4975A",
  betrivers: "#00529B",
  espnbet: "#D00000",
  caesars: "#C8A96E",
  fanatics: "#1B2A4A",
  bet365: "#027B5B",
  hardrock: "#7B1E26",
  parx: "#0B4DA2",
  pinnacle: "#E4472B",
};
