/**
 * Season-progress workload-ramp constants for every pitcher (stat, line) the
 * board offers. See [[pitcher_workload_ramp]]: starters stretch out over a
 * season, so a season-pooled base rate under-states their mid/late-season
 * workload and the pitcher-only projection reads low on innings-driven overs.
 * The bounded ramp (cap=8) that fixes it was validated out-of-sample in
 * scripts/calibrate-pitcher-props.ts; this table extends the same fit to all
 * board lines (regenerate with `npm run fit:pitcherramps`).
 *
 * Slopes are positive for innings-driven stats (K/outs/hits/ER climb as a
 * starter goes deeper) and negative for walks (per-start control firms up).
 */
export const PITCHER_RAMPS: Record<string, { slope: number; pivot: number; cap: number }> = {
  "strikeoutsPitching:3.5": { slope: 0.01116, pivot: 4.57, cap: 8 },
  "strikeoutsPitching:4.5": { slope: 0.01766, pivot: 5.0, cap: 8 },
  "strikeoutsPitching:5.5": { slope: 0.01457, pivot: 5.14, cap: 8 },
  "strikeoutsPitching:6.5": { slope: 0.01407, pivot: 5.31, cap: 8 },
  "strikeoutsPitching:7.5": { slope: 0.01065, pivot: 5.19, cap: 8 },
  "outsRecorded:14.5": { slope: 0.01762, pivot: 4.24, cap: 8 },
  "outsRecorded:15.5": { slope: 0.01863, pivot: 4.46, cap: 8 },
  "outsRecorded:16.5": { slope: 0.02145, pivot: 4.5, cap: 8 },
  "outsRecorded:17.5": { slope: 0.02063, pivot: 4.7, cap: 8 },
  "outsRecorded:18.5": { slope: 0.00932, pivot: 4.19, cap: 8 },
  "outsRecorded:19.5": { slope: 0.00928, pivot: 4.31, cap: 8 },
  "earnedRuns:1.5": { slope: 0.01108, pivot: 4.36, cap: 8 },
  "earnedRuns:2.5": { slope: 0.01312, pivot: 4.29, cap: 8 },
  "earnedRuns:3.5": { slope: 0.01119, pivot: 4.41, cap: 8 },
  "hitsAllowed:3.5": { slope: 0.02118, pivot: 4.5, cap: 8 },
  "hitsAllowed:4.5": { slope: 0.01983, pivot: 4.34, cap: 8 },
  "hitsAllowed:5.5": { slope: 0.02256, pivot: 4.57, cap: 8 },
  "hitsAllowed:6.5": { slope: 0.01323, pivot: 4.5, cap: 8 },
  "hitsAllowed:7.5": { slope: 0.00734, pivot: 4.52, cap: 8 },
  "walksAllowed:1.5": { slope: -0.00537, pivot: 6.63, cap: 8 },
  "walksAllowed:2.5": { slope: -0.0124, pivot: 5.67, cap: 8 },
  "walksAllowed:3.5": { slope: -0.00662, pivot: 5.19, cap: 8 },
};

/**
 * The ramp for a given stat column + line, or undefined for any prop without a
 * fitted ramp (all batting stats, plus any pitcher line off the board's grid) —
 * projectPropHit then applies no ramp. Batting has no workload ramp by design.
 */
export function pitcherRampFor(column: string, line: number): { slope: number; pivot: number; cap: number } | undefined {
  return PITCHER_RAMPS[`${column}:${line}`];
}
