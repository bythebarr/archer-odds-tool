import type { GameMatchup, PitcherInfo } from "@/lib/queries/matchup";
import type { RecordSplit, TeamForm } from "@/lib/queries/teamForm";
import { startSplitEraPerNine } from "@/lib/archer/pitcherRecency";
import { weightedAverage, sampleConfidence, shrinkToward } from "@/lib/stats/weightedAverage";

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
/** Starts needed before a pitcher's season ERA is trusted at full strength; below this the score is shrunk toward neutral (0.5) proportionally, since a handful of starts is too noisy to weight the same as a full sample. */
const PITCHER_FULL_CONFIDENCE_STARTS = 8;

/** Recency weights for a pitcher's ERA — season/last10-starts/last5-starts, mirroring FORM_WEIGHTS's shape (last10 leads) at "start" granularity instead of "game." Renormalized over whichever windows actually have starts logged (see blendedPitcherEra). Same values as teamForm's runs blend — no fitted study exists for pitcher-ERA recency specifically, so this reuses the codebase's one established recency-weighting convention rather than inventing a second one. */
const PITCHER_ERA_WEIGHTS = { season: 0.35, last10: 0.4, last5: 0.25 } as const;

/** Blends a pitcher's season ERA with their trailing last-10/last-5-start ERA, so a hot or cold recent stretch moves the score — not just the season aggregate. Falls back to season ERA alone if no recency split is available yet (early season). Caller must already have checked pitcher.era !== null. */
function blendedPitcherEra(pitcher: PitcherInfo): number {
  return (
    weightedAverage([
      [pitcher.era, PITCHER_ERA_WEIGHTS.season],
      [startSplitEraPerNine(pitcher.last10Starts), PITCHER_ERA_WEIGHTS.last10],
      [startSplitEraPerNine(pitcher.last5Starts), PITCHER_ERA_WEIGHTS.last5],
    ]) ?? pitcher.era!
  );
}

/** Recency weights for team-form components; renormalized over whichever splits actually have games played (see teamFormScore). Last10 leads so a hot/cold streak reads as such, rather than being diluted by the season-long split. */
const FORM_WEIGHTS = { split: 0.35, last10: 0.4, last5: 0.25 } as const;

/** Relative weight of starting pitcher vs. team form; renormalized to form-only if no probable pitcher/ERA is set yet. Form leads — a close pitcher matchup shouldn't cancel out a clear recent-form edge. */
const PITCHER_WEIGHT = 0.4;
const FORM_WEIGHT = 0.6;

/** MLB's long-run home win rate is ~54% — applied as a logit shift on top of the strength differential. */
const HOME_FIELD_LOGIT = Math.log(0.54 / 0.46);
/** Scales the (roughly -0.3..0.3) strength differential into logit space. */
const STRENGTH_SENSITIVITY = 6;

/**
 * Empirical overconfidence calibration for the strength differential — the
 * same technique baked into UFC fighter-math (see CALIBRATION_SHRINK there),
 * applied here after a lookahead-safe backtest exposed how far off the
 * uncalibrated model was. Reconstructing each historical game's actual
 * starter (from pitcher game-logs) and its as-of ERA + team form, the raw
 * model (k=1) scored a Brier of 0.277 over 1,281 games — WORSE than a constant
 * home-base-rate guess (0.250) — because it was wildly overconfident: its
 * 70–85% bucket won only ~56%. Discrimination is real but faint (AUC ~0.548),
 * so the fix is to shrink the differential, not discard it. A shrink of 0.2,
 * fit on the older 70% of games and validated on the newer 30% (test Brier
 * 0.250 vs the raw model's 0.277, matching the base rate), keeps the model's
 * (thin) ability to rank games while collapsing the dangerous overconfidence:
 * the most confident pick drops from the 0.85 cap to ~0.69. This deliberately
 * only shrinks the strength/form differential, NOT HOME_FIELD_LOGIT — home
 * edge is a genuine ~54% base rate that shouldn't be calibrated away.
 *
 * The honest consequence for the flagship: post-calibration, few MLB moneyline
 * plays clear the +EV believability band — correct, since the model barely
 * beats a coin flip on side. Re-fit as the model gains real features (park,
 * bullpen, lineup) and the sample grows; the form component in particular is
 * near-anti-predictive alone (mean-reversion) and is the first thing to rework.
 */
const STRENGTH_CALIBRATION_SHRINK = 0.2;

/** Ceiling/floor on the final win probability. A single 9-inning game stays inherently volatile even when pitcher and form all point the same way, and real markets essentially never price a lone game beyond this — so the model shouldn't either, regardless of how strongly its inputs agree. */
const PROB_CEILING = 0.85;
const PROB_FLOOR = 1 - PROB_CEILING;

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function winPct(r: RecordSplit): number | null {
  return r.gamesFound > 0 ? r.wins / r.gamesFound : null;
}

/** Weighted recent-form score in [0,1], renormalized over whichever splits have games played. Null if none do (e.g. brand-new season). */
function teamFormScore(form: TeamForm, isHome: boolean): number | null {
  return weightedAverage([
    [winPct(isHome ? form.homeRecord : form.awayRecord), FORM_WEIGHTS.split],
    [winPct(form.last10), FORM_WEIGHTS.last10],
    [winPct(form.last5), FORM_WEIGHTS.last5],
  ]);
}

/** Pitcher quality in the same [0,1] units as teamFormScore: 0.5 at league-average ERA (blended with recent-start recency — see blendedPitcherEra). Shrunk toward 0.5 when gamesStarted is below the full-confidence threshold, since an ERA over a handful of starts is too noisy to trust outright. Null if no probable starter or no ERA yet. */
function pitcherQualityScore(pitcher: PitcherInfo | null): number | null {
  if (!pitcher || pitcher.era === null) return null;
  const rawScore = logistic((LEAGUE_AVERAGE_ERA - blendedPitcherEra(pitcher)) / ERA_QUALITY_SPREAD);
  const confidence = sampleConfidence(pitcher.gamesStarted, PITCHER_FULL_CONFIDENCE_STARTS);
  return shrinkToward(rawScore, 0.5, confidence);
}

/** Blends pitcher quality and form into one team-strength score, falling back to whichever component is actually available. */
function teamStrength(formScore: number | null, pitcherScore: number | null): number | null {
  return weightedAverage([
    [formScore, FORM_WEIGHT],
    [pitcherScore, PITCHER_WEIGHT],
  ]);
}

/** One side's named inputs to its team-strength score — the "why" panel's raw material. Both in the same [0,1] scale centered on 0.5 (see teamFormScore/pitcherQualityScore). */
export interface ArcherWinProbabilitySideDrivers {
  formScore: number | null;
  pitcherQualityScore: number | null;
}

export interface ArcherWinProbabilityDrivers {
  home: ArcherWinProbabilitySideDrivers;
  away: ArcherWinProbabilitySideDrivers;
}

export interface ArcherWinProbability {
  homeProb: number | null;
  awayProb: number | null;
  homeStrength: number | null;
  awayStrength: number | null;
  usedPitcher: { home: boolean; away: boolean };
  drivers: ArcherWinProbabilityDrivers;
}

/** Computes the Archer method's home/away win probability for one game from probable-pitcher + team-form data alone. */
export function computeArcherWinProbability(matchup: GameMatchup): ArcherWinProbability {
  const homeFormScore = teamFormScore(matchup.homeForm, true);
  const awayFormScore = teamFormScore(matchup.awayForm, false);
  const homePitcherScore = pitcherQualityScore(matchup.homePitcher);
  const awayPitcherScore = pitcherQualityScore(matchup.awayPitcher);

  const drivers: ArcherWinProbabilityDrivers = {
    home: { formScore: homeFormScore, pitcherQualityScore: homePitcherScore },
    away: { formScore: awayFormScore, pitcherQualityScore: awayPitcherScore },
  };

  const homeStrength = teamStrength(homeFormScore, homePitcherScore);
  const awayStrength = teamStrength(awayFormScore, awayPitcherScore);
  const usedPitcher = { home: homePitcherScore !== null, away: awayPitcherScore !== null };

  if (homeStrength === null || awayStrength === null) {
    return { homeProb: null, awayProb: null, homeStrength, awayStrength, usedPitcher, drivers };
  }

  const rawHomeProb = logistic(
    (homeStrength - awayStrength) * STRENGTH_SENSITIVITY * STRENGTH_CALIBRATION_SHRINK + HOME_FIELD_LOGIT
  );
  const homeProb = Math.min(Math.max(rawHomeProb, PROB_FLOOR), PROB_CEILING);
  return { homeProb, awayProb: 1 - homeProb, homeStrength, awayStrength, usedPitcher, drivers };
}
