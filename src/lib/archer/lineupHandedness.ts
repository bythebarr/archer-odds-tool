import type { Handedness } from "@/generated/prisma/client";

/**
 * A team's season-to-date plate-appearance mix by batter handedness — the
 * "who's actually been in the lineup" signal the pitcher-platoon shift
 * (pitcherPlatoon.ts) weights a starter's vs-hand splits against. Weighted
 * by actual plate appearances (from PlayerGameLog), not roster composition,
 * so a bench player's handedness doesn't count the same as an everyday
 * starter's.
 *
 * Pure and DB-free (same shape as archer/bullpenRate.ts). A season
 * aggregate, not a windowed/trailing split — there's no recency dimension
 * to "who bats for this team," unlike bullpen quality or pitcher ERA.
 */

export interface LineupHandednessMix {
  leftPA: number;
  rightPA: number;
  /** Switch-hitters — deliberately kept separate rather than assigned to L or R here, since which side they actually bat from depends on the OPPOSING PITCHER'S hand at the plate appearance, not a fixed attribute of the batter. Resolved at use time by resolveEffectiveLeftShare. */
  switchPA: number;
}

/** One batter's plate-appearance total for one game, as read from PlayerGameLog joined to MlbPlayer.batSide. */
export interface BattingHandRow {
  teamId: string;
  batSide: Handedness | null;
  plateAppearances: number | null;
}

/** Aggregates raw batting rows into each team's season plate-appearance mix by handedness. */
export function buildLineupHandednessMix(rows: BattingHandRow[]): Map<string, LineupHandednessMix> {
  const byTeam = new Map<string, LineupHandednessMix>();
  for (const r of rows) {
    if (!r.batSide || !r.plateAppearances) continue;
    const mix = byTeam.get(r.teamId) ?? { leftPA: 0, rightPA: 0, switchPA: 0 };
    if (r.batSide === "L") mix.leftPA += r.plateAppearances;
    else if (r.batSide === "R") mix.rightPA += r.plateAppearances;
    else mix.switchPA += r.plateAppearances; // "S"
    byTeam.set(r.teamId, mix);
  }
  return byTeam;
}

/**
 * Effective share of plate appearances that will bat LEFT-handed against a
 * pitcher throwing `pitcherHand` — a switch-hitter bats opposite the
 * pitcher's own hand (the standard platoon convention: left-handed against
 * a right-handed pitcher, and vice versa), while every other batter's side
 * is fixed regardless of who's on the mound. Null only when the team has no
 * batting sample at all. When `pitcherHand` itself is unknown (the
 * probable starter's own handedness hasn't synced yet — rare), defaults
 * switch-hitters to batting left, since right-handed pitchers are the
 * league-wide majority.
 */
export function resolveEffectiveLeftShare(mix: LineupHandednessMix, pitcherHand: Handedness | null): number | null {
  const totalPA = mix.leftPA + mix.rightPA + mix.switchPA;
  if (totalPA === 0) return null;
  const switchBatsLeft = pitcherHand !== "L";
  const effectiveLeftPA = mix.leftPA + (switchBatsLeft ? mix.switchPA : 0);
  return effectiveLeftPA / totalPA;
}
