/**
 * Soccer's ARCHR model — an online Poisson attack/defense goals model, built
 * entirely on free football-data.co.uk history (zero Odds API credits). The model
 * LAYER: the pure 3-way probability model plus its lookahead-safe calibration
 * sampler, decoupled from any live-odds pipeline so it can be validated (calibration
 * + CLV) on free data today. The live SportAdapter drops in later once the paid
 * odds-feed decision is made. See docs/architecture/calibration.md.
 */
import { fetchFootballData, type SoccerMatch } from "./footballData";
import { SoccerPoisson } from "./poisson";
import type { CalibrationSample } from "@/lib/engine/calibration";
import type { SportModel } from "@/lib/engine/types";

/** Seasons with closing odds coverage + enough warm-up depth for the Poisson fit. */
export const DEFAULT_SEASONS = ["1617", "1718", "1819", "1920", "2021", "2122", "2223", "2324", "2425"];

/** Below this many games for either team, the goals model has too little signal. */
const MIN_GAMES_FOR_SIGNAL = 6;

/** Load the full free history once, chronological (shared by both backtests). */
export async function loadSoccerHistory(): Promise<SoccerMatch[]> {
  const all = await fetchFootballData(DEFAULT_SEASONS);
  return all.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Lookahead-safe backtest sampler for the Poisson model. Replays the whole free
 * history chronologically through one model; at each match, BEFORE applying it,
 * records the model FAVORITE outcome (the most-likely of home/draw/away) and
 * whether it occurred — the same favorite convention as tennis/UFC/MLB/NFL, so the
 * verdict is comparable in the trust table. Cold-start matches (either team under
 * MIN_GAMES) are skipped so the verdict reflects the real operating regime.
 */
export async function collectSoccerSamples({ limit }: { limit: number }): Promise<CalibrationSample[]> {
  const matches = await loadSoccerHistory();
  const model = new SoccerPoisson();
  const chrono: CalibrationSample[] = [];
  for (const m of matches) {
    model.touch(m.home, m.season);
    model.touch(m.away, m.season);
    if (
      model.gamesPlayed(m.home) >= MIN_GAMES_FOR_SIGNAL &&
      model.gamesPlayed(m.away) >= MIN_GAMES_FOR_SIGNAL
    ) {
      const p = model.outcomeProbs(m.home, m.away);
      // Favorite = argmax over the 3-way distribution (home > draw > away on ties).
      const favProb = Math.max(p.home, p.draw, p.away);
      const favOutcome = favProb === p.home ? "H" : favProb === p.draw ? "D" : "A";
      chrono.push({ pred: favProb, won: favOutcome === m.result ? 1 : 0 });
    }
    model.update(m.home, m.away, m.homeGoals, m.awayGoals);
  }
  return chrono.slice(-limit).reverse();
}

/**
 * Soccer Poisson goals model. Free-data, public-info — first model to natively price
 * a 3-way market (win/draw/loss). Calibration-validated via `npm run backtest:soccer`;
 * CLV-tested via `npm run backtest:soccer:clv`. Stays SIGNAL-ONLY if it doesn't beat
 * the close, like the rest (see [[models_dont_beat_the_close]]).
 */
export const SOCCER_MODEL: SportModel = {
  describes: "Poisson attack/defense goals model → 3-way home/draw/away probabilities",
  backtest: { unit: "match", collect: collectSoccerSamples },
  // Baked from `npm run backtest:soccer` (N=12000) after the drawBoost fix — our
  // best-calibrated model (skill -0.0130), overall gap -0.1pt, refit best-shrink 1.00.
  // Still CLV-negative (see backtest:soccer:clv). Refresh when the model/params change.
  calibration: {
    verdict: "trusted",
    brier: 0.2368,
    baseRateBrier: 0.2498,
    n: 12000,
    asOf: "2026-07-16",
  },
};
