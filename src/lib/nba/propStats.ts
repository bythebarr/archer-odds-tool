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
  turnovers: number;
}

/** 10+ in at least `needed` of points, rebounds, assists, steals, blocks — a double- (2) or triple-double (3). */
function tens(l: NbaStatLine): number {
  return [l.points, l.rebounds, l.assists, l.steals, l.blocks].filter((v) => v >= 10).length;
}

export interface NbaPropStatDef {
  key: NbaPropStat;
  label: string;
  shortLabel: string;
  value: (log: NbaStatLine) => number;
  /**
   * Yes/No milestones (double-double, triple-double): the log value is 1 when it
   * happened, and the model prices it from the component stats' projections —
   * the chance at least `needed` of them reach 10.
   */
  milestone?: { components: NbaPropStat[]; needed: number };
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
  { key: "blocksSteals", label: "Steals + Blocks", shortLabel: "STK", value: (l) => l.steals + l.blocks },
  { key: "turnovers", label: "Turnovers", shortLabel: "TO", value: (l) => l.turnovers },
  {
    key: "doubleDouble",
    label: "Double-Double",
    shortLabel: "DD",
    value: (l) => (tens(l) >= 2 ? 1 : 0),
    milestone: { components: ["points", "rebounds", "assists", "steals", "blocks"], needed: 2 },
  },
  {
    key: "tripleDouble",
    label: "Triple-Double",
    shortLabel: "TD",
    value: (l) => (tens(l) >= 3 ? 1 : 0),
    milestone: { components: ["points", "rebounds", "assists", "steals", "blocks"], needed: 3 },
  },
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
  player_turnovers: "turnovers",
  player_blocks_steals: "blocksSteals",
  player_steals_blocks: "blocksSteals",
  player_double_double: "doubleDouble",
  player_triple_double: "tripleDouble",
};

/** The Odds API's alternate ladders (`player_points_alternate`…): ordinary over/unders at more numbers. */
export function nbaAlternateMarketStat(marketKey: string): NbaPropStat | null {
  if (!marketKey.endsWith("_alternate")) return null;
  return NBA_MARKET_KEY_TO_STAT[marketKey.slice(0, -"_alternate".length)] ?? null;
}

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
