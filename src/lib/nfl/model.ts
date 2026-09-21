/**
 * NFL's ARCHR model — team Elo win probability, built entirely on free nflverse
 * history (zero Odds API credits). This is the model LAYER: the pure win-prob model
 * plus its lookahead-safe calibration sampler. It's deliberately decoupled from any
 * live-odds pipeline — the model can be validated (calibration + CLV) on free data
 * today, and a full SportAdapter (ingest/listPlays/grade/nav) drops in later once the
 * paid odds-feed decision is made. See docs/architecture/calibration.md.
 */
import { fetchNflGames } from "./games";
import { NflElo } from "./elo";
import type { CalibrationSample } from "@/lib/engine/calibration";
import type { SportModel } from "@/lib/engine/types";

/** Below this many games for either team, Elo has too little signal to price. */
export const MIN_GAMES_FOR_SIGNAL = 8;

/**
 * Lookahead-safe backtest sampler for the NFL Elo model. Replays the whole free
 * nflverse game history in chronological order through one Elo instance; at each
 * game, BEFORE applying it, records the model favorite's pre-game probability vs
 * whether that favorite actually won — the same favorite convention as tennis/UFC/
 * MLB. The pre-game rating is blind to the result by construction (no leakage).
 * Cold-start games (either team under MIN_GAMES) and the rare tie are skipped so the
 * verdict reflects the model's real operating regime.
 */
export async function collectNflSamples({ limit }: { limit: number }): Promise<CalibrationSample[]> {
  const all = await fetchNflGames();
  const games = all
    .filter((g) => g.result !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const elo = new NflElo();
  const chrono: CalibrationSample[] = [];
  for (const g of games) {
    elo.touch(g.home, g.season);
    elo.touch(g.away, g.season);
    const result = g.result as number;
    if (
      result !== 0 && // ties aren't a clean win/loss test
      elo.gamesPlayed(g.home) >= MIN_GAMES_FOR_SIGNAL &&
      elo.gamesPlayed(g.away) >= MIN_GAMES_FOR_SIGNAL
    ) {
      const pHome = elo.winProbHome(g.home, g.away);
      const homeWon = result > 0;
      const favHome = pHome >= 0.5;
      chrono.push({
        pred: favHome ? pHome : 1 - pHome, // the model favorite's probability
        won: favHome === homeWon ? 1 : 0, // did that favorite win
      });
    }
    elo.update(g.home, g.away, result);
  }
  // Most-recent `limit` samples, newest-first (for the harness's time split).
  return chrono.slice(-limit).reverse();
}

/**
 * NFL team-Elo model. Free-data, public-info — calibration-trusted (honest win
 * probabilities), but per the CLV backtest (`npm run backtest:nfl:clv`) it does NOT
 * beat the closing line, so it stays SIGNAL-ONLY like tennis/UFC when the live
 * adapter lands. See [[models_dont_beat_the_close]] / docs/architecture/calibration.md.
 */
export const NFL_MODEL: SportModel = {
  describes: "team Elo win probability (home-field + margin-of-victory, season-reverted)",
  backtest: { unit: "game", collect: collectNflSamples },
  // Baked from `npm run backtest:nfl` (N=6000) — honest win probs (each 50–85%
  // bucket lands within ~2pt of actual; refit best-shrink 0.95, baked model holds).
  // Strong calibration, ~as good as tennis — yet still CLV-negative (see backtest:nfl:clv).
  // Refresh when the model or its params change.
  calibration: {
    verdict: "trusted",
    brier: 0.2199,
    baseRateBrier: 0.2292,
    n: 6000,
    asOf: "2026-07-16",
  },
};
