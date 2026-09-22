import type { GameMatchup, PitcherInfo } from "@/lib/queries/matchup";
import type { RunsSplit, TeamForm } from "@/lib/queries/teamForm";
import type { BullpenSplit } from "@/lib/archer/bullpenRate";
import { startSplitEraPerNine } from "@/lib/archer/pitcherRecency";
import { platoonRunsShift } from "@/lib/archer/pitcherPlatoon";
import type { LineupHandednessMix } from "@/lib/archer/lineupHandedness";
import { weightedAverage, sampleConfidence, shrinkToward } from "@/lib/stats/weightedAverage";

/**
 * The "Archer Runs" model: projects each team's expected runs scored in a
 * game from their own recent scoring, the opponent's recent runs allowed,
 * the opposing starter's ERA, the opposing bullpen's own trailing quality,
 * and a platoon-matchup shift from the opposing starter's own
 * vs-handedness splits against tonight's specific lineup composition. It's
 * the shared primitive behind both the totals and spread flavors of Archer
 * EV (see runProbability.ts) — one projection per team, rather than two
 * independent formulas, so a pitcher/form signal that moves the total also
 * moves the spread lean consistently.
 *
 * Same "transparent v1 heuristic, not a fitted model" caveat as
 * winProbability.ts — every constant below is a documented guess, not
 * backtested, with no opponent-quality/park adjustment. The platoon shift
 * (see archer/pitcherPlatoon.ts) is a stronger version of this caveat: it
 * cannot be backtested with today's data model at all, not just "hasn't
 * been yet."
 */

/** Modern-era MLB average runs scored per team per game — the shrinkage anchor for every rate below (offense, defense, and pitcher ERA are all treated on this one scale). Recalibrate if league-wide scoring shifts materially. */
const LEAGUE_AVG_RUNS_PER_GAME = 4.3;

/** Games needed before a runs-for/runs-against rate is trusted at full strength; below this it's shrunk toward league average proportionally — early-season or short-window samples are too noisy otherwise. */
const RUNS_FULL_CONFIDENCE_GAMES = 15;

/** Starts needed before a pitcher's ERA is trusted at full strength — same threshold and rationale as winProbability.ts's PITCHER_FULL_CONFIDENCE_STARTS, kept separate here since the two models could be tuned independently. */
const PITCHER_FULL_CONFIDENCE_STARTS = 8;

/** Relief innings pitched (team-wide, summed across every reliever) needed before a team's trailing bullpen rate is trusted at full strength. In innings rather than games, since a team's bullpen accrues innings from several pitchers per game — a games-based threshold would understate the real sample size. ~15 games * ~3-4 relief IP/game puts this in the same early-season trust-earning ballpark as RUNS_FULL_CONFIDENCE_GAMES. */
const BULLPEN_FULL_CONFIDENCE_INNINGS = 60;

/** Recency weights for a pitcher's ERA — season/last10-starts/last5-starts, mirroring RUNS_WEIGHTS's shape (last10 leads) at "start" granularity instead of "game." Same values as winProbability.ts's copy — kept separate per-file since the two models could be tuned independently, same reasoning as PITCHER_FULL_CONFIDENCE_STARTS above. */
const PITCHER_ERA_WEIGHTS = { season: 0.35, last10: 0.4, last5: 0.25 } as const;

/** Blends a pitcher's season ERA with their trailing last-10/last-5-start ERA, so a hot or cold recent stretch moves the projection — not just the season aggregate. Falls back to season ERA alone if no recency split is available yet (early season). Caller must already have checked pitcher.era !== null. */
function blendedPitcherEra(pitcher: PitcherInfo): number {
  return (
    weightedAverage([
      [pitcher.era, PITCHER_ERA_WEIGHTS.season],
      [startSplitEraPerNine(pitcher.last10Starts), PITCHER_ERA_WEIGHTS.last10],
      [startSplitEraPerNine(pitcher.last5Starts), PITCHER_ERA_WEIGHTS.last5],
    ]) ?? pitcher.era!
  );
}

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
 * A team's own trailing bullpen runs-per-9, shrunk toward league average by
 * relief-innings sample size. Falls back to LEAGUE_AVG_RUNS_PER_GAME (today's
 * pre-existing behavior) when the split is null or has no qualifying relief
 * innings yet — early season, or a team with no PlayerGameLog history.
 */
function bullpenExpectedRunRate(bullpen: BullpenSplit | null): number {
  if (!bullpen || bullpen.outsRecorded === 0) return LEAGUE_AVG_RUNS_PER_GAME;
  const relieverInnings = bullpen.outsRecorded / 3;
  const rawRunsPerNine = (9 * bullpen.earnedRuns) / relieverInnings;
  const confidence = sampleConfidence(relieverInnings, BULLPEN_FULL_CONFIDENCE_INNINGS);
  return shrinkToward(rawRunsPerNine, LEAGUE_AVG_RUNS_PER_GAME, confidence);
}

/**
 * Pitcher's expected contribution to the team's runs allowed, in the same
 * runs/game units as weightedRunsRate. ERA is a rate over 9 innings, but a
 * starter doesn't pitch 9 innings — a typical outing is ~5-6, with the
 * bullpen covering the rest. Without this split, a great start (low ERA)
 * understated the team's true runs-allowed expectation, and a poor start
 * overstated it, since a meaningful chunk of any game happens after the
 * starter leaves regardless of how they pitched. ERA itself still treated as
 * a direct runs proxy (ignores unearned runs) — same simplification as
 * before, just no longer silently applied to the whole game. Shrunk toward
 * league average when gamesStarted is low. Null if no probable starter or no
 * ERA yet. `bullpen` is THIS pitcher's own team's trailing bullpen split
 * (see computeExpectedRuns) — the team that relieves them, not the opponent.
 */
function pitcherExpectedRuns(pitcher: PitcherInfo | null, bullpen: BullpenSplit | null): number | null {
  if (!pitcher || pitcher.era === null) return null;
  const confidence = sampleConfidence(pitcher.gamesStarted, PITCHER_FULL_CONFIDENCE_STARTS);
  const shrunkEraRunsPerNine = shrinkToward(blendedPitcherEra(pitcher), LEAGUE_AVG_RUNS_PER_GAME, confidence);

  const avgInningsPerStart =
    pitcher.inningsPitched !== null && pitcher.gamesStarted > 0
      ? pitcher.inningsPitched / pitcher.gamesStarted
      : DEFAULT_INNINGS_PER_START;
  const starterShare = Math.min(Math.max(avgInningsPerStart / 9, 0), 1);
  const bullpenShare = 1 - starterShare;

  return shrunkEraRunsPerNine * starterShare + bullpenExpectedRunRate(bullpen) * bullpenShare;
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

/**
 * Additive platoon-matchup shift on top of the blended projection above —
 * see archer/pitcherPlatoon.ts for the full mechanism and its important
 * "cannot be backtested" caveat. `pitcher` is who the BATTING team (whose
 * projection this shift feeds into) is facing; `battingTeamMix` is that
 * batting team's own season handedness composition. Zero (never null)
 * whenever the pitcher or lineup-mix data isn't available, so this can
 * only ever nudge an existing projection, never null one out.
 */
function opposingPlatoonShift(pitcher: PitcherInfo | null, battingTeamMix: LineupHandednessMix | null): number {
  if (!pitcher) return 0;
  return platoonRunsShift(pitcher.pitchHand, pitcher.platoonVsLeft, pitcher.platoonVsRight, battingTeamMix);
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
  const homePitcherRuns = pitcherExpectedRuns(matchup.homePitcher, matchup.homeBullpen);
  const awayPitcherRuns = pitcherExpectedRuns(matchup.awayPitcher, matchup.awayBullpen);

  const home = blendExpectedRuns(homeOffense, awayDefense, awayPitcherRuns);
  const away = blendExpectedRuns(awayOffense, homeDefense, homePitcherRuns);

  return {
    home: home === null ? null : home + opposingPlatoonShift(matchup.awayPitcher, matchup.homeLineupMix),
    away: away === null ? null : away + opposingPlatoonShift(matchup.homePitcher, matchup.awayLineupMix),
  };
}
