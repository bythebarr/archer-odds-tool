/**
 * Model trust — the read side of the calibration gate (sport-engine Phase 4a).
 *
 * These read the baked `SportModel.calibration` snapshot (refreshed by
 * `npm run backtest:<sport>`), so callers can ask "is this sport's model trusted
 * to price the paid card?" with zero DB work. The default is CONSERVATIVE: a
 * sport with no model, no backtest, or a non-`trusted` verdict is untrusted — so a
 * brand-new sport's model can't leak onto the card before it clears the harness.
 *
 * What posts reads `stakeable` below: a model-priced play from a sport whose
 * verdict isn't `trusted` never posts as a staked play (card or free); it rides
 * the unstaked slate instead. The verdict comes from the latest /models report
 * card (`ModelReport`, saved by the Model lab), falling back to the baked snapshot
 * only for a sport with no saved report. See docs/architecture/calibration.md.
 */
import { getAdapter } from "./registry";
import type { CalibrationSnapshot, Play } from "./types";

/** The baked calibration snapshot for a sport, or null if it has none. */
export function modelCalibration(sportKey: string): CalibrationSnapshot | null {
  return getAdapter(sportKey)?.model?.calibration ?? null;
}

/**
 * Whether a sport's model has earned the right to price the card. True ONLY for a
 * `trusted` verdict — `marginal`, `unproven`, `thin`, missing snapshot, and
 * no-model all read false. Conservative by design: trust is opt-in, earned by
 * clearing the harness, never assumed.
 */
export function isModelTrusted(sportKey: string): boolean {
  return modelCalibration(sportKey)?.verdict === "trusted";
}

/** Each sport's verdict as /models shows it: the latest saved report card, keyed by sport. */
export type ReportedVerdicts = ReadonlyMap<string, string>;

/**
 * The verdict that gates a sport's staked plays: its latest /models report card
 * when one exists, else the baked snapshot, else null (no model, no backtest).
 */
export function trustVerdict(sportKey: string, reported: ReportedVerdicts): string | null {
  return reported.get(sportKey) ?? modelCalibration(sportKey)?.verdict ?? null;
}

/**
 * Whether a play may post as a staked play (card or free). A play the model
 * didn't price (`modelEv` null) leans on no model, so it isn't gated; a
 * model-priced play needs its sport's verdict to be `trusted`.
 */
export function stakeable(play: Play, reported: ReportedVerdicts): boolean {
  return play.modelEv === null || trustVerdict(play.sportKey, reported) === "trusted";
}
