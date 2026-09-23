import type { PropMarket } from "@/lib/nfl/props/model";

/** Display order and labels for the NFL props board's market tabs. */
export const MARKET_ORDER: PropMarket[] = ["passingYards", "rushingYards", "receivingYards", "receptions", "completions", "passAttempts", "rushAttempts"];

export const MARKET_META: Record<PropMarket, { label: string; short: string; unit: string; decimals: number }> = {
  passingYards: { label: "Passing Yards", short: "Pass Yds", unit: "pass yds", decimals: 1 },
  rushingYards: { label: "Rushing Yards", short: "Rush Yds", unit: "rush yds", decimals: 1 },
  receivingYards: { label: "Receiving Yards", short: "Rec Yds", unit: "rec yds", decimals: 1 },
  receptions: { label: "Receptions", short: "Rec", unit: "receptions", decimals: 1 },
  completions: { label: "Completions", short: "Cmp", unit: "completions", decimals: 1 },
  passAttempts: { label: "Pass Attempts", short: "Pass Att", unit: "attempts", decimals: 1 },
  rushAttempts: { label: "Rush Attempts", short: "Rush Att", unit: "carries", decimals: 1 },
};
