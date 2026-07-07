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
