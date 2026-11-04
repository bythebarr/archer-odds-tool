/**
 * Play-level provenance (display only). Answers "should this play carry the
 * unproven-model badge?" off the same verdict the trust gate reads
 * (./trust.ts), so the label and the gate can never disagree about which
 * models are proven. Nothing here filters, ranks, or stakes a play —
 * selection is untouched; this only labels what already shows.
 */
import { isUnprovenVerdict } from "../modelBadge";
import { trustVerdict, type ReportedVerdicts } from "./trust";
import type { Play } from "./types";

/**
 * Whether a play was priced by an unproven model. A play no model priced
 * (`modelEv` null) leans on no model, so it is never badged; a model-priced
 * play is badged unless its sport's verdict is `trusted`.
 */
export function playIsUnproven(
  play: Pick<Play, "sportKey" | "modelEv">,
  reported: ReportedVerdicts,
): boolean {
  if (play.modelEv === null) return false;
  return isUnprovenVerdict(trustVerdict(play.sportKey, reported));
}

/**
 * Whether a sport's model is unproven, for surfaces that present one model's
 * output as a block (the Slate's UFC strip) rather than play by play.
 */
export function sportModelIsUnproven(sportKey: string, reported: ReportedVerdicts): boolean {
  return isUnprovenVerdict(trustVerdict(sportKey, reported));
}
