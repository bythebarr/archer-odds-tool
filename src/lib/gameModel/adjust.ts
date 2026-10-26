/**
 * What the ratings can't see: tonight's rest and who's out. Each adjustment
 * moves the expected score in points, is a prior from public research, and is
 * measured by the games backtest.
 */
import type { ExpectedScore } from "./ratings";

/** NBA back-to-back: about −1.25 points for the tired team (2003–10 study; 1–2 pts in others). */
export const NBA_B2B_PENALTY = 1.25;
/** NFL coming off a bye: a small edge in modern data. Short week (Thursday after Sunday): a small cost. */
export const NFL_BYE_EDGE = 0.75;
export const NFL_SHORT_WEEK = 0.5;

export interface RestRead {
  /** Days since each team's previous game; null when unknown (season opener). */
  homeDays: number | null;
  awayDays: number | null;
}

/** Points each side gains (+) or loses (−) to rest. */
export function restEdge(sport: "nba" | "nfl", rest: RestRead): { home: number; away: number } {
  const one = (days: number | null) => {
    if (days === null) return 0;
    if (sport === "nba") return days <= 1 ? -NBA_B2B_PENALTY : 0;
    if (days >= 13) return NFL_BYE_EDGE;
    if (days <= 5) return -NFL_SHORT_WEEK;
    return 0;
  };
  return { home: one(rest.homeDays), away: one(rest.awayDays) };
}

export interface MissingPlayer {
  name: string;
  status: string;
  /** Points of margin the team loses without him (see playerImpact). */
  impact: number;
}

/**
 * Applies rest and absences to an expected score. A missing player costs his
 * team `impact` points of margin: 60% from its own scoring, 40% added to the
 * opponent's (players defend too).
 */
export function adjustExpected(
  base: ExpectedScore,
  rest: { home: number; away: number },
  missing: { home: MissingPlayer[]; away: MissingPlayer[] }
): ExpectedScore {
  const lost = (list: MissingPlayer[]) => list.reduce((a, p) => a + p.impact, 0);
  const h = lost(missing.home);
  const a = lost(missing.away);
  return {
    home: base.home + rest.home / 2 - rest.away / 2 - 0.6 * h + 0.4 * a,
    away: base.away + rest.away / 2 - rest.home / 2 - 0.6 * a + 0.4 * h,
  };
}

/** Share of an out player's impact applied when he's only questionable / doubtful. */
export function statusWeight(level: "out" | "doubtful" | "questionable" | "probable" | null): number {
  return level === "out" ? 1 : level === "doubtful" ? 0.85 : level === "questionable" ? 0.35 : 0;
}

/**
 * NBA player impact on margin: his box-score production per game above what a
 * replacement produces in the same minutes, scaled to points of margin.
 * A star (~30/7/7) lands around 6, an average starter around 1, a bench piece ~0.
 */
export const NBA_REPLACEMENT_PER_MIN = 0.55;
export const NBA_IMPACT_SCALE = 0.35;
export function nbaPlayerImpact(logs: { minutes: number; points: number; rebounds: number; assists: number; steals: number; blocks: number; turnovers: number }[]): number {
  const g = logs.filter((l) => l.minutes > 0).slice(0, 15);
  if (g.length < 3) return 0;
  const avg = (f: (l: (typeof g)[number]) => number) => g.reduce((s, l) => s + f(l), 0) / g.length;
  const production = avg((l) => l.points + 0.5 * l.rebounds + 0.7 * l.assists + l.steals + 0.7 * l.blocks - l.turnovers);
  const surplus = production - NBA_REPLACEMENT_PER_MIN * avg((l) => l.minutes);
  return Math.min(Math.max(surplus * NBA_IMPACT_SCALE, 0), 9);
}

/** NFL: a starting QB out is the biggest single swing in the sport; others count a little. */
export const NFL_QB_IMPACT = 4.5;
export const NFL_SKILL_IMPACT = 0.6;
export const NFL_SKILL_CAP = 2;
