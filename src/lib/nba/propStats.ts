/**
 * The NBA prop catalog: what each stat is called, how to read it off a game log,
 * and which provider market keys price it.
 */
import type { NbaPropStat } from "@/generated/prisma/client";

/** The logged columns a stat can be built from. */
export interface NbaStatLine {
  points: number;
  rebounds: number;
  assists: number;
  threesMade: number;
  steals: number;
  blocks: number;
}

export interface NbaPropStatDef {
  key: NbaPropStat;
  label: string;
  shortLabel: string;
  value: (log: NbaStatLine) => number;
}

/** Display order: the singles books lead with, then the combos. */
export const NBA_PROP_STATS: NbaPropStatDef[] = [
  { key: "points", label: "Points", shortLabel: "PTS", value: (l) => l.points },
  { key: "rebounds", label: "Rebounds", shortLabel: "REB", value: (l) => l.rebounds },
  { key: "assists", label: "Assists", shortLabel: "AST", value: (l) => l.assists },
  { key: "threes", label: "3-Pointers Made", shortLabel: "3PM", value: (l) => l.threesMade },
  { key: "pointsReboundsAssists", label: "Pts + Reb + Ast", shortLabel: "PRA", value: (l) => l.points + l.rebounds + l.assists },
  { key: "pointsRebounds", label: "Pts + Reb", shortLabel: "P+R", value: (l) => l.points + l.rebounds },
  { key: "pointsAssists", label: "Pts + Ast", shortLabel: "P+A", value: (l) => l.points + l.assists },
  { key: "reboundsAssists", label: "Reb + Ast", shortLabel: "R+A", value: (l) => l.rebounds + l.assists },
  { key: "steals", label: "Steals", shortLabel: "STL", value: (l) => l.steals },
  { key: "blocks", label: "Blocks", shortLabel: "BLK", value: (l) => l.blocks },
];

export const NBA_PROP_STAT_BY_KEY = new Map(NBA_PROP_STATS.map((s) => [s.key, s]));

/**
 * Provider market key → the stat it prices. An ALLOWLIST, for the reason
 * propMarkets.ts gives for MLB: an unmapped market is invisible, a mis-mapped one
 * puts a wrong line on the board. Two-player markets (`*_h2h`, `*_either_*`),
 * first-basket, and double/triple-double markets are deliberately absent — none
 * is one player's over/under on a logged stat.
 *
 * Spellings cover The Odds API's documented NBA keys and the obvious variants a
 * provider without normalization produces. Keys the feed sends that aren't here
 * are counted by name in the poll summary, so a missing spelling shows up on the
 * first live run instead of silently costing a market.
 */
export const NBA_MARKET_KEY_TO_STAT: Record<string, NbaPropStat> = {
  player_points: "points",
  player_rebounds: "rebounds",
  player_assists: "assists",
  player_threes: "threes",
  player_threes_made: "threes",
  player_three_pointers_made: "threes",
  player_3pt_made: "threes",
  player_steals: "steals",
  player_blocks: "blocks",
  player_points_rebounds_assists: "pointsReboundsAssists",
  player_pra: "pointsReboundsAssists",
  player_points_rebounds: "pointsRebounds",
  player_points_assists: "pointsAssists",
  player_rebounds_assists: "reboundsAssists",
};

/**
 * `*_alt` keys. On this provider MLB's turned out to be MILESTONE markets ("1 or
 * more hits", line 1.0, over only) — see PARLAY_MILESTONE_MARKETS. NBA's are
 * expected to follow the same convention ("25+ points"), but that's unverified,
 * so the shift is applied only to a whole-number line, which is what a milestone
 * looks like. A half-point alt line is already an ordinary over and is kept as is.
 */
export function nbaAltMarketStat(marketKey: string): NbaPropStat | null {
  if (!marketKey.endsWith("_alt")) return null;
  return NBA_MARKET_KEY_TO_STAT[marketKey.slice(0, -"_alt".length)] ?? null;
}
