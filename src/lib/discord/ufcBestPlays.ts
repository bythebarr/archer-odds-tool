import { listUpcomingUfcEvents } from "@/lib/queries/ufcEvents";
import { getUfcMatchup } from "@/lib/queries/ufcMatchup";
import { getBestLinesForBouts, type UfcCornerBestLine } from "@/lib/queries/ufcOdds";
import { computeUfcWinProbability } from "@/lib/ufc/fighterMath";
import { computeFinishProjection, scheduledRoundsForBout, type FinishMethod, type FinishProjection } from "@/lib/ufc/finishMath";
import { calculateEv } from "@/lib/odds/devig";

/**
 * "Fight-night" best plays for the Discord card — the fighter-math model's
 * edges on the next UFC event, now priced as real **Archer EV** plays (the same
 * model-vs-market lens as the MLB card), thanks to the UFC moneyline feed.
 *
 * The play is the VALUE side: for each bout we compute Archer EV on BOTH
 * corners (our model probability vs the best book price) and back whichever has
 * the higher edge — which is often the underdog the market overrates our man's
 * opponent against, NOT simply the model favorite. Selection is gated by the
 * same believability band as MLB (drop sub-floor coin-flips and above-ceiling
 * plays that are almost always model miscalibration, not free money).
 *
 * These ARE recorded as PostedPlay and graded into #results (see postCard.ts /
 * postResults.ts): a bout without a matched line can't be priced and is skipped.
 */

/**
 * The finish-math lean for a pick — HOW Archer sees the backed fighter winning,
 * from computeFinishProjection (method × round). The card's analyst voice on top
 * of the raw EV: "sees KO/TKO ~R2", not just a number.
 */
export interface UfcFinishLean {
  /** The backed fighter's most likely winning method (conditional on him winning). */
  method: FinishMethod;
  /** Most likely finish round for the pick; null for a decision lean. */
  round: number | null;
  /** P(the fight ends inside the distance), 0..1 — the "finish %" behind a KO/sub lean. */
  finishProb: number;
  /** P(the fight goes to a decision), 0..1 — the number behind a decision lean. */
  distanceProb: number;
}

export interface UfcBestPlay {
  boutId: string;
  /** Corner backed — drives grading (winner === this corner's fighter). */
  side: "red" | "blue";
  /** The backed fighter's id, for grading against the bout winner. */
  pickFighterId: string;
  pickName: string;
  opponentName: string;
  /** Model win probability for the backed fighter (fighter-math, capped [0.2,0.8]). */
  prob: number;
  /** Best moneyline (American) for the backed fighter across allowlisted books. */
  bestPrice: number;
  bestBookName: string;
  /** Archer EV (model prob vs best price) as a fraction of stake. */
  archerEv: number;
  titleBout: boolean;
  weightClass: string;
  /** Fighter-math method/round lean for the backed fighter (null if unprojectable). */
  finishLean?: UfcFinishLean | null;
}

/**
 * Derive the backed fighter's finish lean from the full fight's finish
 * projection: normalize his own method mix (ko/sub/dec, which sums to his win
 * prob) to "given he wins, how," pick the dominant path, and for a finish read
 * the most likely round off his per-round curve. Pure over the projection.
 */
export function deriveFinishLean(finish: FinishProjection, side: "red" | "blue"): UfcFinishLean | null {
  if (!finish.available) return null;
  const byFighter = side === "red" ? finish.byFighter.a : finish.byFighter.b;
  const perRound = side === "red" ? finish.perFighterRounds.a : finish.perFighterRounds.b;
  const winMass = byFighter.ko + byFighter.submission + byFighter.decision;
  if (winMass <= 1e-9) return null;

  let method: FinishMethod;
  if (byFighter.decision >= byFighter.ko && byFighter.decision >= byFighter.submission) method = "decision";
  else method = byFighter.ko >= byFighter.submission ? "ko" : "submission";

  let round: number | null = null;
  if (method !== "decision") {
    let best = 0;
    for (let i = 1; i < perRound.length; i++) if (perRound[i] > perRound[best]) best = i;
    round = best + 1;
  }

  return { method, round, finishProb: finish.finishProb, distanceProb: finish.goesTheDistanceProb };
}

export interface UfcCard {
  eventTitle: string;
  eventDate: Date;
  plays: UfcBestPlay[];
}

/**
 * Only feature a card this close (in days) to fight night. UFC events are
 * ~weekly and the poster runs daily, so without this the same plays would
 * repost every day for a week. Tune against how early you want to tease a card.
 */
const LOOKAHEAD_DAYS = 3;
/** Keep the fight-night section a curated card, not the full 13-bout slate. */
const MAX_UFC_PLAYS = 6;
/**
 * Believability band on Archer EV, shared with the MLB card's philosophy: below
 * the floor there's no real edge; above the ceiling it's almost always model
 * miscalibration (thin fight history, a stale line), not a genuine lock — a
 * capper who posts "+57% EV" plays and goes 3-7 is done. Tune against #results.
 */
const MIN_ARCHER_EV = 0.03;
const MAX_ARCHER_EV = 0.2;

const DAY_MS = 24 * 60 * 60 * 1000;

interface BoutMeta {
  id: string;
  weightClass: string;
  titleBout: boolean;
  redId: string;
  redName: string;
  blueId: string;
  blueName: string;
}

/**
 * Pure: choose the value side of a bout by Archer EV and gate on the
 * believability band. Computes EV for each corner that has a line, backs the
 * higher-EV side, and returns null for a coin-flip-ish/no-edge play, a play
 * above the miscalibration ceiling, a bout with no line, or one the model
 * couldn't price (null prob). Separated from the fetch so the selection rule is
 * unit-testable without a DB.
 */
export function pickFromBout(
  bout: BoutMeta,
  redProb: number | null,
  blueProb: number | null,
  redLine: UfcCornerBestLine | null,
  blueLine: UfcCornerBestLine | null,
  minEv = MIN_ARCHER_EV,
  maxEv = MAX_ARCHER_EV
): UfcBestPlay | null {
  if (redProb === null || blueProb === null) return null;

  const redEv = redLine ? calculateEv(redProb, redLine.priceAmerican) : null;
  const blueEv = blueLine ? calculateEv(blueProb, blueLine.priceAmerican) : null;

  // Back the higher-EV side (the value side, often the dog).
  let side: "red" | "blue";
  if (redEv !== null && (blueEv === null || redEv >= blueEv)) side = "red";
  else if (blueEv !== null) side = "blue";
  else return null; // neither corner has a line — can't price it

  const ev = side === "red" ? redEv! : blueEv!;
  if (ev < minEv || ev > maxEv) return null; // outside the believability band

  const line = side === "red" ? redLine! : blueLine!;
  return {
    boutId: bout.id,
    side,
    pickFighterId: side === "red" ? bout.redId : bout.blueId,
    pickName: side === "red" ? bout.redName : bout.blueName,
    opponentName: side === "red" ? bout.blueName : bout.redName,
    prob: side === "red" ? redProb : blueProb,
    bestPrice: line.priceAmerican,
    bestBookName: line.bookKey,
    archerEv: ev,
    titleBout: bout.titleBout,
    weightClass: bout.weightClass,
  };
}

/**
 * The fighter-math Archer EV plays for the next upcoming UFC event, if it's
 * within the lookahead window and priced. Returns null when there's no imminent
 * card or no bout clears the band — the poster then omits the UFC section.
 * Assumes odds are already fresh (the poster calls ensureUfcOddsFresh first).
 */
export async function getUfcBestPlays(now: Date = new Date()): Promise<UfcCard | null> {
  const [event] = await listUpcomingUfcEvents(1);
  if (!event) return null;
  // getUfcMatchup's history queries already filter to hasStats events, and
  // eventDate here is a clean Date (the /ufc list formats it the same way).
  if (event.eventDate.getTime() > now.getTime() + LOOKAHEAD_DAYS * DAY_MS) return null;

  const lines = await getBestLinesForBouts(event.bouts.map((b) => b.id));

  const candidates = await Promise.all(
    event.bouts.map(async (bout) => {
      const matchup = await getUfcMatchup(bout.id);
      if (!matchup) return null;
      const proj = computeUfcWinProbability(matchup, now);
      const line = lines.get(bout.id);
      // fighterA = red corner, fighterB = blue corner (see getUfcMatchup).
      const play = pickFromBout(
        {
          id: bout.id,
          weightClass: bout.weightClass,
          titleBout: bout.titleBout,
          redId: bout.red.id,
          redName: bout.red.name,
          blueId: bout.blue.id,
          blueName: bout.blue.name,
        },
        proj.fighterAProb,
        proj.fighterBProb,
        line?.red ?? null,
        line?.blue ?? null
      );
      if (!play) return null;

      // Attach the finish/round lean for the backed corner. Scheduled rounds
      // honor the main-event/title 5-round rule (upcoming bout: no resultRound).
      const scheduledRounds = scheduledRoundsForBout({
        titleBout: bout.titleBout,
        isMainEvent: bout.isMainEvent,
        resultRound: null,
      });
      const finish = computeFinishProjection(matchup, proj.fighterAProb, scheduledRounds, now);
      play.finishLean = deriveFinishLean(finish, play.side);
      return play;
    })
  );

  const plays = candidates
    .filter((p): p is UfcBestPlay => p !== null)
    // Highest edge first; title bouts break ties (they're the headline).
    .sort((a, b) => b.archerEv - a.archerEv || Number(b.titleBout) - Number(a.titleBout))
    .slice(0, MAX_UFC_PLAYS);

  if (!plays.length) return null;
  return { eventTitle: event.title, eventDate: event.eventDate, plays };
}
