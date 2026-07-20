/**
 * Model trust — the read side of the calibration gate (sport-engine Phase 4a).
 *
 * These read the baked `SportModel.calibration` snapshot (refreshed by
 * `npm run backtest:<sport>`), so callers can ask "is this sport's model trusted
 * to price the paid card?" with zero DB work. The default is CONSERVATIVE: a
 * sport with no model, no backtest, or a non-`trusted` verdict is untrusted — so a
 * brand-new sport's model can't leak onto the card before it clears the harness.
 *
 * This is the seam; wiring it into what actually posts (suppress/demote
 * model-priced plays from untrusted sports) is a separate, owner-gated switch,
 * because it changes what the paid room sees. See docs/architecture/calibration.md.
 */
import { getAdapter } from "./registry";
import type { CalibrationSnapshot } from "./types";

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
