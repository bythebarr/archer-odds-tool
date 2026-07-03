import type { GameMatchup, PitcherInfo } from "@/lib/queries/matchup";
import type { RecordSplit, TeamForm } from "@/lib/queries/teamForm";

/**
 * The "Archer" win-probability model: turns the matchup panel's own
 * comparison data (probable-pitcher ERA + recent team form) into a single
 * home/away win probability, computed independently of market odds so it
 * can be shown side by side with the market's own implied probability.
 *
 * This is a transparent v1 heuristic, not a fitted or backtested model — no
 * opponent/park/bullpen/lineup adjustment. Every constant below is a
 * deliberate, documented guess, tunable in one place. Same "directional, not
 * rigorous" caveat as historical hit-rate EV (see lineEconomics.ts).
 *
 * Deliberately excludes rolling bet hit-rate: that measures whether bets on
 * a team have cashed against a market line, not team strength — mixing it in
 * here would blur what this number means.
 */

/** MLB league-average starter ERA, the zero point for pitcher quality. Recalibrate if league-wide scoring shifts materially. */
const LEAGUE_AVERAGE_ERA = 4.2;
/** Controls how sharply an ERA gap moves quality away from 0.5 — larger = gentler. */
const ERA_QUALITY_SPREAD = 1.4;

/** Recency weights for team-form components; renormalized over whichever splits actually have games played (see teamFormScore). Last10 leads so a hot/cold streak reads as such, rather than being diluted by the season-long split. */
const FORM_WEIGHTS = { split: 0.35, last10: 0.4, last5: 0.25 } as const;

/** Relative weight of starting pitcher vs. team form; renormalized to form-only if no probable pitcher/ERA is set yet. Form leads — a close pitcher matchup shouldn't cancel out a clear recent-form edge. */
const PITCHER_WEIGHT = 0.4;
const FORM_WEIGHT = 0.6;

/** MLB's long-run home win rate is ~54% — applied as a logit shift on top of the strength differential. */
const HOME_FIELD_LOGIT = Math.log(0.54 / 0.46);
/** Scales the (roughly -0.3..0.3) strength differential into logit space. */
const STRENGTH_SENSITIVITY = 6;

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function winPct(r: RecordSplit): number | null {
  return r.gamesFound > 0 ? r.wins / r.gamesFound : null;
}

/** Weighted recent-form score in [0,1], renormalized over whichever splits have games played. Null if none do (e.g. brand-new season). */
function teamFormScore(form: TeamForm, isHome: boolean): number | null {
  const components: [number | null, number][] = [
    [winPct(isHome ? form.homeRecord : form.awayRecord), FORM_WEIGHTS.split],
    [winPct(form.last10), FORM_WEIGHTS.last10],
    [winPct(form.last5), FORM_WEIGHTS.last5],
  ];
  const available = components.filter((c): c is [number, number] => c[0] !== null);
  if (available.length === 0) return null;

  const weightSum = available.reduce((sum, [, w]) => sum + w, 0);
  return available.reduce((sum, [v, w]) => sum + v * w, 0) / weightSum;
}

/** Pitcher quality in the same [0,1] units as teamFormScore: 0.5 at league-average ERA. Null if no probable starter or no ERA yet. */
function pitcherQualityScore(pitcher: PitcherInfo | null): number | null {
  if (!pitcher || pitcher.era === null) return null;
  return logistic((LEAGUE_AVERAGE_ERA - pitcher.era) / ERA_QUALITY_SPREAD);
}

/** Blends pitcher quality and form into one team-strength score, falling back to whichever component is actually available. */
function teamStrength(pitcher: PitcherInfo | null, form: TeamForm, isHome: boolean): number | null {
  const formScore = teamFormScore(form, isHome);
  const pitcherScore = pitcherQualityScore(pitcher);

  if (formScore === null) return pitcherScore;
  if (pitcherScore === null) return formScore;
  return PITCHER_WEIGHT * pitcherScore + FORM_WEIGHT * formScore;
}

export interface ArcherWinProbability {
  homeProb: number | null;
  awayProb: number | null;
  homeStrength: number | null;
  awayStrength: number | null;
  usedPitcher: { home: boolean; away: boolean };
}

/** Computes the Archer method's home/away win probability for one game from probable-pitcher + team-form data alone. */
export function computeArcherWinProbability(matchup: GameMatchup): ArcherWinProbability {
  const homeStrength = teamStrength(matchup.homePitcher, matchup.homeForm, true);
  const awayStrength = teamStrength(matchup.awayPitcher, matchup.awayForm, false);
  const usedPitcher = {
    home: pitcherQualityScore(matchup.homePitcher) !== null,
    away: pitcherQualityScore(matchup.awayPitcher) !== null,
  };

  if (homeStrength === null || awayStrength === null) {
    return { homeProb: null, awayProb: null, homeStrength, awayStrength, usedPitcher };
  }

  const homeProb = logistic((homeStrength - awayStrength) * STRENGTH_SENSITIVITY + HOME_FIELD_LOGIT);
  return { homeProb, awayProb: 1 - homeProb, homeStrength, awayStrength, usedPitcher };
}
