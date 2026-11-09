/**
 * The tracking -> ModelReport bridge: forward tracking's graded leans,
 * aggregated into report cards the /models page can render -- WITHOUT ever
 * pooling them into the backtest sample.
 *
 * Why this exists: pick tracking (capture/settle/evaluate) grades every lean
 * ARCHR actually made, frozen before the game and graded after -- the
 * freshest, lookahead-free evidence in the system. But it only ever surfaced
 * on the owner-only /models/edges page; it never wrote ModelReport, so the
 * public cards sat on frozen backtest populations while thousands of graded
 * forward leans piled up unread. This module is the bridge: one card per
 * (sport, market, stat), scored by the same calibration harness every
 * backtest card uses (lib/engine/calibration), from the tracker's own
 * population only.
 *
 * Honesty rules (pinned by bridge.test.ts):
 *   - Every bridge card's model key carries the `tracking:` prefix and its
 *     extras carry `source: "forward-tracking"`. A tracking verdict can
 *     never be mistaken for -- or summed into -- a backtest verdict: the
 *     report layer keys cards by model string, and these keys are disjoint
 *     from every backtest key (`nba-props:*`, `market-blend:*`, ...).
 *   - The population is exactly what lib/queries/edgeReport loads for
 *     /models/edges: settled leans of the TRACKED_MODELS, corrections
 *     applied, unknown feature schemas skipped. The bridge adds no second
 *     reading of the evidence, and the backtests never read settlements --
 *     the two samples are disjoint by construction, so no lean can be
 *     counted twice.
 *   - Verdicts come from scoreCalibration with its default thresholds --
 *     the same bar every other card clears (the market fit's 300-sample
 *     weight bar is a pricing rule, not a verdict rule; the bridge fits no
 *     weights and prices nothing).
 *   - A group with no hit/miss leans (empty, or pushes/voids only) yields
 *     NO card: absent, not a row of zeros.
 *
 * Pure: leans in, card specs out. The script (scripts/report-tracking.ts)
 * does the loading and saving.
 */
import { etDateOf } from "@/lib/dateEt";
import type { CalibrationSample } from "@/lib/engine/calibration";
import { scoreSegment, type SegmentStats } from "./evaluate";
import type { GradedLean } from "./types";

/** The `extra.source` value on every ModelReport row this bridge writes. */
export const TRACKING_SOURCE = "forward-tracking";

export interface TrackingCardSpec {
  /** ModelReport key, e.g. "tracking:nba:props:points". */
  modelKey: string;
  label: string;
  /** ModelReport unit noun ("prop" | "game"), matching the priced-product cards. */
  unit: string;
  /** Calibration samples (hit/miss only), newest first, ready for scoreCalibration. */
  samples: CalibrationSample[];
  /** The tracker's own read of the same group (ROI at captured prices, CLV vs the close). */
  segment: SegmentStats;
  /** Alternate-line leans inside a props group (graded alongside the main line; evaluation's stat segments pool them the same way). */
  altN: number;
  /** Pushes/voids in the group: real leans, excluded from the samples, never silently dropped from the count. */
  pushes: number;
  voids: number;
}

const SPORT_LABEL = { nba: "NBA", nfl: "NFL" } as const;
const GAME_LABEL = { ml: "moneyline", spread: "spread", total: "total" } as const;

function groupKeyOf(lean: GradedLean): { key: string; label: string; unit: string } {
  const { sport, kind, stat } = lean.features;
  const sportLabel = SPORT_LABEL[sport];
  if (kind === "prop") {
    return {
      key: `tracking:${sport}:props:${stat}`,
      label: `${sportLabel} props - ${stat} (live tracking)`,
      unit: "prop",
    };
  }
  return {
    key: `tracking:${sport}:games:${kind}`,
    label: `${sportLabel} games - ${GAME_LABEL[kind]} (live tracking)`,
    unit: "game",
  };
}

/**
 * Group graded leans into report-card specs. One spec per group that has at
 * least one hit or miss; groups are sorted by model key so runs are
 * deterministic. Samples carry the frozen chance exactly as captured
 * (GradedLean.prob -- the calibrated chance the surfaces showed) and the
 * game's ET date, so the card's data-as-of is the newest lean's date.
 */
export function groupTrackingLeans(leans: GradedLean[]): TrackingCardSpec[] {
  const groups = new Map<string, { label: string; unit: string; leans: GradedLean[] }>();
  for (const lean of leans) {
    const { key, label, unit } = groupKeyOf(lean);
    const g = groups.get(key) ?? { label, unit, leans: [] };
    g.leans.push(lean);
    groups.set(key, g);
  }
  const specs: TrackingCardSpec[] = [];
  for (const [modelKey, g] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const graded = g.leans
      .filter((l) => l.result === "hit" || l.result === "miss")
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
    if (graded.length === 0) continue; // absent, not zeros
    specs.push({
      modelKey,
      label: g.label,
      unit: g.unit,
      samples: graded.map((l) => ({
        pred: l.prob,
        won: (l.result === "hit" ? 1 : 0) as 0 | 1,
        date: etDateOf(l.startsAt),
      })),
      segment: scoreSegment(modelKey, g.label, g.leans),
      altN: g.leans.filter((l) => l.features.alt === true).length,
      pushes: g.leans.filter((l) => l.result === "push").length,
      voids: g.leans.filter((l) => l.result === "void").length,
    });
  }
  return specs;
}
