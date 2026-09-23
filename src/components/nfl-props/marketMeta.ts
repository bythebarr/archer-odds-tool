import type { ServedMarket } from "@/lib/nfl/props/frozen";

/** Display order and labels for the NFL props board's market tabs. */
export const MARKET_ORDER: ServedMarket[] = [
  "passingYards", "rushingYards", "receivingYards", "receptions", "anytimeTd", "rushRecYards", "passRushYards", "passingTds",
  "interceptions", "twoPlusTds", "firstTd", "longestReception", "longestRush", "longestCompletion", "fgMade", "kickingPoints",
  "completions", "passAttempts", "rushAttempts",
];

export const MARKET_META: Record<ServedMarket, { label: string; short: string; unit: string; decimals: number }> = {
  passingYards: { label: "Passing Yards", short: "Pass Yds", unit: "pass yds", decimals: 1 },
  rushingYards: { label: "Rushing Yards", short: "Rush Yds", unit: "rush yds", decimals: 1 },
  receivingYards: { label: "Receiving Yards", short: "Rec Yds", unit: "rec yds", decimals: 1 },
  receptions: { label: "Receptions", short: "Rec", unit: "receptions", decimals: 1 },
  completions: { label: "Completions", short: "Cmp", unit: "completions", decimals: 1 },
  passAttempts: { label: "Pass Attempts", short: "Pass Att", unit: "attempts", decimals: 1 },
  rushAttempts: { label: "Rush Attempts", short: "Rush Att", unit: "carries", decimals: 1 },
  anytimeTd: { label: "Anytime Touchdown", short: "Anytime TD", unit: "exp. TDs", decimals: 2 },
  passingTds: { label: "Passing Touchdowns", short: "Pass TDs", unit: "pass TDs", decimals: 2 },
  rushRecYards: { label: "Rushing + Receiving Yards", short: "Rush+Rec", unit: "rush+rec yds", decimals: 1 },
  passRushYards: { label: "Passing + Rushing Yards", short: "Pass+Rush", unit: "pass+rush yds", decimals: 1 },
  interceptions: { label: "Interceptions Thrown", short: "INTs", unit: "exp. INTs", decimals: 2 },
  twoPlusTds: { label: "2+ Touchdowns", short: "2+ TDs", unit: "exp. TDs", decimals: 2 },
  firstTd: { label: "First Touchdown Scorer", short: "1st TD", unit: "first-TD chance", decimals: 2 },
  longestReception: { label: "Longest Reception", short: "Long Rec", unit: "median longest", decimals: 0 },
  longestRush: { label: "Longest Rush", short: "Long Rush", unit: "median longest", decimals: 0 },
  longestCompletion: { label: "Longest Completion", short: "Long Cmp", unit: "median longest", decimals: 0 },
  fgMade: { label: "Field Goals Made", short: "FGs", unit: "exp. FGs", decimals: 2 },
  kickingPoints: { label: "Kicking Points", short: "Kick Pts", unit: "kicking pts", decimals: 1 },
};
