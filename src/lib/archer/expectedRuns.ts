import type { GameMatchup, PitcherInfo } from "@/lib/queries/matchup";
import type { RunsSplit, TeamForm } from "@/lib/queries/teamForm";
import { weightedAverage, sampleConfidence, shrinkToward } from "@/lib/stats/weightedAverage";

/**
 * The "Archer Runs" model: projects each team's expected runs scored in a
 * game from their own recent scoring, the opponent's recent runs allowed,
 * and the opposing starter's ERA. It's the shared primitive behind both the
 * totals and spread flavors of Archer EV (see runProbability.ts) — one
 * projection per team, rather than two independent formulas, so a pitcher/
 * form signal that moves the total also moves the spread lean consistently.
 *
 * Same "transparent v1 heuristic, not a fitted model" caveat as
 * winProbability.ts — every constant below is a documented guess, not
 * backtested, with no opponent-quality/park/bullpen/lineup adjustment.
 */

/** Modern-era MLB average runs scored per team per game — the shrinkage anchor for every rate below (offense, defense, and pitcher ERA are all treated on this one scale). Recalibrate if league-wide scoring shifts materially. */
const LEAGUE_AVG_RUNS_PER_GAME = 4.3;

/** Games needed before a runs-for/runs-against rate is trusted at full strength; below this it's shrunk toward league average proportionally — early-season or short-window samples are too noisy otherwise. */
const RUNS_FULL_CONFIDENCE_GAMES = 15;

/** Starts needed before a pitcher's ERA is trusted at full strength — same threshold and rationale as winProbability.ts's PITCHER_FULL_CONFIDENCE_STARTS, kept separate here since the two models could be tuned independently. */
const PITCHER_FULL_CONFIDENCE_STARTS = 8;

/** Fallback innings/start when inningsPitched isn't available — roughly a modern-era typical outing, used only so the model degrades to a reasonable estimate rather than losing the bullpen adjustment entirely. */
const DEFAULT_INNINGS_PER_START = 5.5;

/** Recency weights for runs splits; renormalized over whichever windows actually have games played. Mirrors winProbability.ts's FORM_WEIGHTS shape (last10 leads) but keyed to runs windows instead of win/loss ones. */
const RUNS_WEIGHTS = { season: 0.35, last10: 0.4, last5: 0.25 } as const;

/** Relative weight of a team's own scoring rate vs. the opponent's runs-allowed rate vs. the opposing starter's ERA. Offense leads since it's the largest-sample signal; pitcher trails since a single start's ERA sample is the noisiest of the three. */
const OFFENSE_WEIGHT = 0.45;
const DEFENSE_WEIGHT = 0.3;
const PITCHER_WEIGHT = 0.25;

function runsPerGame(split: RunsSplit, side: "for" | "against"): number | null {
  if (split.gamesFound === 0) return null;
  return (side === "for" ? split.runsFor : split.runsAgainst) / split.gamesFound;
}

/** Weighted, confidence-shrunk runs-for or runs-allowed rate in runs/game, anchored on LEAGUE_AVG_RUNS_PER_GAME. Null only if the team has no finished games at all yet. */
function weightedRunsRate(form: TeamForm, side: "for" | "against"): number | null {
  const rawRate = weightedAverage([
    [runsPerGame(form.runsSeason, side), RUNS_WEIGHTS.season],
    [runsPerGame(form.runsLast10, side), RUNS_WEIGHTS.last10],
    [runsPerGame(form.runsLast5, side), RUNS_WEIGHTS.last5],
  ]);
  if (rawRate === null) return null;

  const confidence = sampleConfidence(form.runsSeason.gamesFound, RUNS_FULL_CONFIDENCE_GAMES);
  return shrinkToward(rawRate, LEAGUE_AVG_RUNS_PER_GAME, confidence);
}

/**
 * Pitcher's expected contribution to the team's runs allowed, in the same
 * runs/game units as weightedRunsRate. ERA is a rate over 9 innings, but a
 * starter doesn't pitch 9 innings — a typical outing is ~5-6, with the
 * bullpen covering the rest at a different (roughly league-average) rate.
 * Without this split, a great start (low ERA) understated the team's true
 * runs-allowed expectation, and a poor start overstated it, since a
 * meaningful chunk of any game happens after the starter leaves regardless
 * of how they pitched. ERA itself still treated as a direct runs proxy
 * (ignores unearned runs) — same simplification as before, just no longer
 * silently applied to the whole game. Shrunk toward league average when
 * gamesStarted is low. Null if no probable starter or no ERA yet.
 */
function pitcherExpectedRuns(pitcher: PitcherInfo | null): number | null {
  if (!pitcher || pitcher.era === null) return null;
  const confidence = sampleConfidence(pitcher.gamesStarted, PITCHER_FULL_CONFIDENCE_STARTS);
  const shrunkEraRunsPerNine = shrinkToward(pitcher.era, LEAGUE_AVG_RUNS_PER_GAME, confidence);

  const avgInningsPerStart =
    pitcher.inningsPitched !== null && pitcher.gamesStarted > 0
      ? pitcher.inningsPitched / pitcher.gamesStarted
      : DEFAULT_INNINGS_PER_START;
  const starterShare = Math.min(Math.max(avgInningsPerStart / 9, 0), 1);
  const bullpenShare = 1 - starterShare;

  return shrunkEraRunsPerNine * starterShare + LEAGUE_AVG_RUNS_PER_GAME * bullpenShare;
}

/** Blends one team's offense with the opponent's defense (runs allowed) and the opposing starter's expected runs allowed, falling back to whichever components are actually available. Null only if none are. */
function blendExpectedRuns(
  offenseRate: number | null,
  opponentDefenseRate: number | null,
  opponentPitcherRuns: number | null
): number | null {
  return weightedAverage([
    [offenseRate, OFFENSE_WEIGHT],
    [opponentDefenseRate, DEFENSE_WEIGHT],
    [opponentPitcherRuns, PITCHER_WEIGHT],
  ]);
}

export interface ExpectedRuns {
  home: number | null;
  away: number | null;
}

/** Computes each team's expected runs scored for one game, the shared input to both the Archer total and Archer spread-cover probabilities. */
export function computeExpectedRuns(matchup: GameMatchup): ExpectedRuns {
  const homeOffense = weightedRunsRate(matchup.homeForm, "for");
  const awayOffense = weightedRunsRate(matchup.awayForm, "for");
  const homeDefense = weightedRunsRate(matchup.homeForm, "against");
  const awayDefense = weightedRunsRate(matchup.awayForm, "against");
  const homePitcherRuns = pitcherExpectedRuns(matchup.homePitcher);
  const awayPitcherRuns = pitcherExpectedRuns(matchup.awayPitcher);

  return {
    home: blendExpectedRuns(homeOffense, awayDefense, awayPitcherRuns),
    away: blendExpectedRuns(awayOffense, homeDefense, homePitcherRuns),
  };
}
