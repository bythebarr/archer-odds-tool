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
 *   • `*_combined_*` / `*_either_*` / `*_h2h` span two players — a different bet
 *     entirely, and ungradeable against one player's stat line.
 *
 * `*_alt` used to be refused here too, on the reading that alternate ladders
 * aren't the over/under our grader settles. Half right: the live feed shows they
 * ARE gradeable, but only after a line shift — see PARLAY_MILESTONE_MARKETS.
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
 * Parlay's `*_alt` keys are MILESTONE markets, not alternate over/unders — the
 * `market` label spells it out: "Player Hits Milestones 1 Or More", line 1.0,
 * priced on the over side only.
 *
 * Taken at face value that line is a lie. "1 or more hits" wins on exactly one
 * hit; stored as Over 1.0 our grader needs TWO, so every single-hit game would
 * settle as a loss on a bet that won. The price says the same thing — bet365
 * quoted that row -135, where a true Over 1.0 belongs nearer +180.
 *
 * The translation is a half-point shift: **"N or more" = Over (N - 0.5)**. That
 * lands on the same over/under grid the standard markets use, so the ladder
 * becomes ordinary extra lines rather than a second bet structure — and
 * CurrentPlayerPropLine already carries `point` in its unique key, so the rungs
 * store side by side instead of overwriting each other.
 *
 * Two `*_alt` keys are deliberately left out:
 *   • `player_strikeouts_alt` — inherits the same pitcher/batter ambiguity as
 *     `player_strikeouts`, and at 19 rows isn't worth the risk of polluting the
 *     one edge that survived backtesting.
 *   • `player_stolen_bases_alt` — no StatCategory to grade it against.
 */
export const PARLAY_MILESTONE_MARKETS: Record<string, string> = {
  player_hits_alt: "batter_hits",
  player_home_runs_alt: "batter_home_runs",
  player_total_bases_alt: "batter_total_bases",
  player_runs_alt: "batter_runs_scored",
};

/** Half-point shift turning a "N or more" milestone into an Over line. */
export function milestonePoint(line: number): number {
  return line - 0.5;
}

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
 *
 * Braces catch a second kind of leak: an UNRENDERED book template, seen live as
 * "{optionTypeAbbr}{value} Hits". Those carry no digits, so the rule above
 * waves them through.
 */
export function looksLikePlayerName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 2 && !/[0-9+]/.test(trimmed) && !/[{}]/.test(trimmed);
}
