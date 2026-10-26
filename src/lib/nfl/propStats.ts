/**
 * The NFL prop catalog: what each stat is called, how to read it off a game
 * log, which positions it applies to, and which provider market keys price it.
 */
import type { NflPropStat } from "@/generated/prisma/client";

/** The logged columns a stat can be built from. */
export interface NflStatLine {
  passAttempts: number;
  passCompletions: number;
  passYards: number;
  passTds: number;
  interceptions: number;
  rushAttempts: number;
  rushYards: number;
  rushTds: number;
  receptions: number;
  targets: number;
  recYards: number;
  recTds: number;
}

/**
 * How a stat is distributed game to game, which decides how the projection
 * turns a mean into a probability: yards are wide and roughly symmetric around
 * a big mean (normal); counts are small and skewed (negative binomial); a TD
 * scorer prop is "at least one" (Poisson).
 */
export type StatShape = "yards" | "count" | "anytime";

export interface NflPropStatDef {
  key: NflPropStat;
  label: string;
  shortLabel: string;
  shape: StatShape;
  /** The position group whose usage drives the stat — the defense-by-position read. */
  group: "QB" | "RUSH" | "REC" | "SKILL";
  value: (log: NflStatLine) => number;
}

/** Display order: the markets members shop most first. */
export const NFL_PROP_STATS: NflPropStatDef[] = [
  { key: "passYards", label: "Passing Yards", shortLabel: "PASS YDS", shape: "yards", group: "QB", value: (l) => l.passYards },
  { key: "rushYards", label: "Rushing Yards", shortLabel: "RUSH YDS", shape: "yards", group: "RUSH", value: (l) => l.rushYards },
  { key: "recYards", label: "Receiving Yards", shortLabel: "REC YDS", shape: "yards", group: "REC", value: (l) => l.recYards },
  { key: "receptions", label: "Receptions", shortLabel: "REC", shape: "count", group: "REC", value: (l) => l.receptions },
  { key: "anytimeTd", label: "Anytime TD", shortLabel: "TD", shape: "anytime", group: "SKILL", value: (l) => l.rushTds + l.recTds },
  { key: "passTds", label: "Passing TDs", shortLabel: "PASS TD", shape: "count", group: "QB", value: (l) => l.passTds },
  { key: "passCompletions", label: "Completions", shortLabel: "CMP", shape: "count", group: "QB", value: (l) => l.passCompletions },
  { key: "passAttempts", label: "Pass Attempts", shortLabel: "ATT", shape: "count", group: "QB", value: (l) => l.passAttempts },
  { key: "interceptions", label: "Interceptions", shortLabel: "INT", shape: "count", group: "QB", value: (l) => l.interceptions },
  { key: "rushAttempts", label: "Rush Attempts", shortLabel: "CAR", shape: "count", group: "RUSH", value: (l) => l.rushAttempts },
  { key: "rushRecYards", label: "Rush + Rec Yards", shortLabel: "R+R YDS", shape: "yards", group: "SKILL", value: (l) => l.rushYards + l.recYards },
];

export const NFL_PROP_STAT_BY_KEY = new Map(NFL_PROP_STATS.map((s) => [s.key, s]));

/**
 * Provider market key → stat. An ALLOWLIST, as for NBA and MLB: an unmapped
 * market is invisible, a mis-mapped one puts a wrong line on the board. Covers
 * The Odds API's documented NFL keys and the spellings ParlayAPI is known to
 * use for the same markets.
 */
export const NFL_MARKET_KEY_TO_STAT: Record<string, NflPropStat> = {
  player_pass_yds: "passYards",
  player_passing_yards: "passYards",
  player_pass_tds: "passTds",
  player_passing_touchdowns: "passTds",
  player_pass_completions: "passCompletions",
  player_pass_attempts: "passAttempts",
  player_pass_interceptions: "interceptions",
  player_interceptions: "interceptions",
  player_rush_yds: "rushYards",
  player_rushing_yards: "rushYards",
  player_rush_attempts: "rushAttempts",
  player_receptions: "receptions",
  player_reception_yds: "recYards",
  player_receiving_yards: "recYards",
  player_rush_reception_yds: "rushRecYards",
  player_rush_and_receive_yds: "rushRecYards",
  player_anytime_td: "anytimeTd",
};

/** Our position group for an ESPN position abbreviation. */
export function nflPositionGroup(position: string | null | undefined): "QB" | "RB" | "WR" | "TE" | null {
  const p = position?.trim().toUpperCase();
  if (p === "QB") return "QB";
  if (p === "RB" || p === "FB" || p === "HB") return "RB";
  if (p === "WR") return "WR";
  if (p === "TE") return "TE";
  return null;
}
