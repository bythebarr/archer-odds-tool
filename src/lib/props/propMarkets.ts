import type { StatCategory } from "@/generated/prisma/client";

/**
 * Maps our 11 StatCategory values to The Odds API's real MLB player-prop
 * market keys — confirmed live against their docs and a real per-event
 * response (see odds_api_credit_budget memory / conversation this was added
 * in). 1:1, no bundling: each category costs one full market slot in the
 * `markets x regions` per-event cost formula.
 */
export const STAT_CATEGORY_TO_MARKET_KEY: Record<StatCategory, string> = {
  hits: "batter_hits",
  totalBases: "batter_total_bases",
  homeRuns: "batter_home_runs",
  rbi: "batter_rbis",
  runs: "batter_runs_scored",
  battingStrikeouts: "batter_strikeouts",
  pitcherStrikeouts: "pitcher_strikeouts",
  earnedRuns: "pitcher_earned_runs",
  hitsAllowed: "pitcher_hits_allowed",
  walksAllowed: "pitcher_walks",
  outsRecorded: "pitcher_outs",
};

export const MARKET_KEY_TO_STAT_CATEGORY: Record<string, StatCategory> = Object.fromEntries(
  Object.entries(STAT_CATEGORY_TO_MARKET_KEY).map(([category, marketKey]) => [marketKey, category])
) as Record<string, StatCategory>;

/**
 * All 11 market keys, requested together on every per-event props fetch —
 * "full fidelity" scope decided in the credit-budget conversation. Costs
 * 11 credits/game at the decided 1-region (`us`) scope.
 */
export const ALL_PLAYER_PROP_MARKET_KEYS = Object.values(STAT_CATEGORY_TO_MARKET_KEY);

/** Only the `us` region — the decided scope, half the cost of matching game-lines' us+us2. */
export const PLAYER_PROP_REGIONS = ["us"];

/**
 * ParlayAPI's market vocabulary → the Odds-API keys the storage layer already
 * understands. Translating here keeps `MARKET_KEY_TO_STAT_CATEGORY`, and
 * everything downstream of it, provider-agnostic.
 *
 * This is an ALLOWLIST, and deliberately conservative. Parlay exposes 112 MLB
 * market keys from 15 books with no normalization between them, and several are
 * unusable:
 *
 *   • `player_strikeouts` is AMBIGUOUS and polluted — one key carrying pitcher
 *     lines (3.5-6.5), batter lines (0.5-1.5), and rows whose "player" is a
 *     label like "7+ Strikeouts". Mapping it would silently corrupt pitcher
 *     strikeouts, the one edge that survived backtesting. `player_pitcher_
 *     strikeouts` and `player_strikeouts_thrown` are unambiguous; we use those.
 *   • `*_alt` / `*_milestones` are different bet structures (alternate ladders,
 *     yes/no milestones), not the over/under our grader settles.
 *   • `*_combined_*` / `*_either_*` / `*_h2h` span two players — a different bet
 *     entirely, and ungradeable against one player's stat line.
 *
 * Fewer correct props beats more wrong ones: an unmapped market is invisible,
 * but a mis-mapped one produces a graded record that lies.
 */
export const PARLAY_MARKET_KEY_TO_ODDS_API_KEY: Record<string, string> = {
  // Batting
  player_hits: "batter_hits",
  player_total_bases: "batter_total_bases",
  player_home_runs: "batter_home_runs",
  player_rbis: "batter_rbis",
  player_runs_batted_in: "batter_rbis",
  player_runs: "batter_runs_scored",
  player_hitter_strikeouts: "batter_strikeouts",
  player_batter_walks: "batter_walks",
  player_bat_walks: "batter_walks",

  // Pitching — only the keys that name the pitcher role explicitly.
  player_pitcher_strikeouts: "pitcher_strikeouts",
  player_strikeouts_thrown: "pitcher_strikeouts",
  player_earned_runs: "pitcher_earned_runs",
  player_earned_runs_allowed: "pitcher_earned_runs",
  player_hits_allowed: "pitcher_hits_allowed",
  player_walks_allowed: "pitcher_walks",
  player_pitching_walks: "pitcher_walks",
  player_outs: "pitcher_outs",
  player_outs_recorded: "pitcher_outs",
  player_pitcher_outs: "pitcher_outs",
  player_pitching_outs: "pitcher_outs",
};

/**
 * Markets only a PITCHER can have. Used to learn who's pitching from the feed
 * itself, which is how the ambiguous strikeouts market gets resolved.
 */
export const PARLAY_PITCHER_ONLY_MARKETS = new Set([
  "player_earned_runs",
  "player_earned_runs_allowed",
  "player_hits_allowed",
  "player_outs",
  "player_outs_recorded",
  "player_pitcher_outs",
  "player_pitching_outs",
  "player_pitching_walks",
  "player_walks_allowed",
  "player_pitcher_strikeouts",
  "player_strikeouts_thrown",
]);

/**
 * `player_strikeouts` is the market we can't take at face value AND can't
 * afford to drop.
 *
 * Refusing it outright was the first instinct — it mixes batter and pitcher
 * lines in one bucket — but the live feed settles the argument: the explicit
 * `player_pitcher_strikeouts` key had ONE row (a single exchange), while
 * `player_strikeouts` had 101 across ten books including Pinnacle. Dropping it
 * leaves pitcher strikeouts, the one backtested edge, with no market at all.
 *
 * So it's disambiguated instead, in priority order:
 *   1. If the player is quoted elsewhere in the SAME feed on a pitcher-only
 *      market (earned runs, outs, hits allowed), they're a pitcher. This is
 *      evidence, not a guess.
 *   2. Otherwise fall back to the line: MLB batter strikeout props run 0.5-2.5,
 *      starting-pitcher props 3.5+. The gap is wide and stable.
 *
 * A batter mis-read as a pitcher would pollute the edge, so rule 1 leads and
 * the threshold only covers players the feed says nothing else about.
 */
const PITCHER_LINE_FLOOR = 3;

export function resolveStrikeoutsMarket(line: number, isKnownPitcher: boolean): string {
  if (isKnownPitcher) return "pitcher_strikeouts";
  return line >= PITCHER_LINE_FLOOR ? "pitcher_strikeouts" : "batter_strikeouts";
}

/** Parlay key → our key, or null when the market isn't one we can grade. */
export function normalizeParlayMarketKey(key: string): string | null {
  return PARLAY_MARKET_KEY_TO_ODDS_API_KEY[key] ?? null;
}

/**
 * Some rows carry a market LABEL in the player field ("7+ Strikeouts") rather
 * than a person — milestone markets leaking through. A real name has no digits
 * or plus signs, so this rejects them before they reach player matching, where
 * they'd otherwise pile up as noise in `unmatchedPlayerNames`.
 */
export function looksLikePlayerName(name: string): boolean {
  return name.trim().length > 2 && !/[0-9+]/.test(name);
}
