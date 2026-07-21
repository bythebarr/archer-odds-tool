/**
 * Maps a book feed's team name onto the name our schedule source uses.
 *
 * MLB games are matched to odds events by exact team name, with the canonical
 * side coming from the MLB Stats API. When the two sources disagree the game
 * simply goes unpriced — silently, since an unmatched event is just a line in a
 * summary nobody reads.
 *
 * Live example (2026-07-21): MLB dropped the city when the Athletics left
 * Oakland, so Stats API says "Athletics" while ParlayAPI still says "Oakland
 * Athletics". That one mismatch cost us every A's game, every poll.
 *
 * Deliberately an explicit alias list rather than fuzzy matching: a wrong team
 * match writes another game's prices onto a board, which is the exact class of
 * bug the event-assignment rewrite in ingest.ts exists to prevent. An unmatched
 * event is recoverable; a mismatched one is corruption.
 */

/** Feed name (normalized) -> the name MLB Stats API uses. */
const ALIASES: Record<string, string> = {
  // The A's relocation: MLB uses the bare nickname, books still prefix the old city.
  "oakland athletics": "Athletics",
  "las vegas athletics": "Athletics",
};

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The schedule-source name for a feed's team name — unchanged when no alias applies. */
export function canonicalTeamName(feedName: string): string {
  return ALIASES[normalize(feedName)] ?? feedName;
}
