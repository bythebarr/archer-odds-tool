import { listUpcomingUfcEvents } from "@/lib/queries/ufcEvents";
import { getUfcMatchup } from "@/lib/queries/ufcMatchup";
import { computeUfcWinProbability } from "@/lib/ufc/fighterMath";

/**
 * "Fight-night" leans for the Discord card — the fighter-math model's best
 * plays on the next UFC event. UFC carries NO odds in our data (results/form
 * only, like F1), so these are MODEL LEANS with a confidence %, not +EV plays:
 * "my fighter math likes X," not "X is +6% EV." That's the capper product for
 * a sport we can't price against a market.
 *
 * Informational only: NOT recorded as PostedPlay or auto-graded. PostedPlay is
 * odds-shaped (a non-null price drives its unit P/L), and grading UFC by fight
 * result is a clean follow-up — a win-rate ledger, not a unit ledger. For now
 * these post as leans; the record they build is eyeballed against results.
 */

export interface UfcBestPlay {
  boutId: string;
  /** The fighter the model favors. */
  pickName: string;
  opponentName: string;
  /** Model win probability for the pick, in [0.5, 0.8] (fighter-math is capped). */
  prob: number;
  titleBout: boolean;
  weightClass: string;
}

export interface UfcCard {
  eventTitle: string;
  eventDate: Date;
  plays: UfcBestPlay[];
}

/**
 * Only feature a card this close (in days) to fight night. UFC events are
 * ~weekly and the poster runs daily, so without this the same leans would
 * repost every day for a week. Tune against how early you want to tease a card.
 */
const LOOKAHEAD_DAYS = 3;
/**
 * A lean must clear this model confidence to count as a "best play" — below it
 * the fight is a coin flip and not worth posting. Fighter-math is bounded to
 * [0.2, 0.8], so this is the meaningful-edge floor. Tune against the paper-log.
 */
const MIN_CONFIDENCE = 0.6;
/** Keep the fight-night section a curated card, not the full 13-bout slate. */
const MAX_UFC_PLAYS = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

interface BoutMeta {
  id: string;
  weightClass: string;
  titleBout: boolean;
  redName: string;
  blueName: string;
}

/**
 * Pure: resolve the favored fighter from a bout's red/blue win probs and gate
 * on confidence. Returns null for a coin flip (below the floor) or a bout the
 * model couldn't price (null prob — insufficient fight history). Separated from
 * the fetch so the selection rule is unit-testable without a DB.
 */
export function pickFromBout(
  bout: BoutMeta,
  redProb: number | null,
  blueProb: number | null,
  minConfidence = MIN_CONFIDENCE
): UfcBestPlay | null {
  if (redProb === null || blueProb === null) return null;
  const redFavored = redProb >= blueProb;
  const prob = redFavored ? redProb : blueProb;
  if (prob < minConfidence) return null;
  return {
    boutId: bout.id,
    pickName: redFavored ? bout.redName : bout.blueName,
    opponentName: redFavored ? bout.blueName : bout.redName,
    prob,
    titleBout: bout.titleBout,
    weightClass: bout.weightClass,
  };
}

/**
 * The fighter-math best plays for the next upcoming UFC event, if it's within
 * the lookahead window. Returns null when there's no imminent card or no bout
 * clears the confidence floor — the poster then simply omits the UFC section.
 */
export async function getUfcBestPlays(now: Date = new Date()): Promise<UfcCard | null> {
  const [event] = await listUpcomingUfcEvents(1);
  if (!event) return null;
  // getUfcMatchup's history queries already filter to hasStats events, and
  // eventDate here is a clean Date (the /ufc list formats it the same way).
  if (event.eventDate.getTime() > now.getTime() + LOOKAHEAD_DAYS * DAY_MS) return null;

  const candidates = await Promise.all(
    event.bouts.map(async (bout) => {
      const matchup = await getUfcMatchup(bout.id);
      if (!matchup) return null;
      const proj = computeUfcWinProbability(matchup, now);
      // fighterA = red corner, fighterB = blue corner (see getUfcMatchup).
      return pickFromBout(
        {
          id: bout.id,
          weightClass: bout.weightClass,
          titleBout: bout.titleBout,
          redName: bout.red.name,
          blueName: bout.blue.name,
        },
        proj.fighterAProb,
        proj.fighterBProb
      );
    })
  );

  const plays = candidates
    .filter((p): p is UfcBestPlay => p !== null)
    // Title bouts first at equal confidence (they're the headline), else by edge.
    .sort((a, b) => b.prob - a.prob || Number(b.titleBout) - Number(a.titleBout))
    .slice(0, MAX_UFC_PLAYS);

  if (!plays.length) return null;
  return { eventTitle: event.title, eventDate: event.eventDate, plays };
}
