/**
 * Strict as-of Elo reconstruction for the NFL research vertical slice. Pure
 * orchestration only — no model math lives here. Every number comes from
 * `NflElo` (`src/lib/nfl/elo.ts`) and `DEFAULT_NFL_ELO`, imported and used
 * exactly as `src/lib/nfl/model.ts`'s `collectNflSamples` already does for
 * the calibration harness; this module does not reimplement `winProbHome`,
 * `expectedHomeMargin`, or `update` — it replays history through the SAME
 * class and hands back the resulting instance for a caller (the display page
 * and the prediction-capture builder) to read directly.
 */
import { NflElo, DEFAULT_NFL_ELO, type NflEloOpts } from "../elo";
import type { NflGame } from "../games";

export interface NflEloAsOfBook {
  /** The replayed Elo instance, as of `asOfUtc` — call its own `.rating()`/`.gamesPlayed()`/`.winProbHome()`/`.expectedHomeMargin()` methods directly; nothing here re-derives what those already compute. */
  elo: NflElo;
  /** Every nflverse team code that appeared in at least one game included in the replay (i.e., strictly before `asOfUtc`). */
  teamsSeen: Set<string>;
  /** The Elo options actually used for this replay — frozen alongside the result so a caller can record exactly what produced it. */
  opts: NflEloOpts;
}

/**
 * Replays nflverse's game history through one `NflElo` instance, strictly
 * before `asOfUtc` — mirrors `src/lib/cfb/ratings.ts`'s `buildTeamRatings`
 * as-of discipline: a game is included only if `game.date.getTime() <
 * asOfUtc.getTime()` (strict, matching `ratings.test.ts`'s "enforces a
 * strict as-of cutoff" and this project's existing leakage-safety
 * convention), sorted chronologically before replay so `.touch()`'s
 * between-season reversion and `.update()`'s sequencing are correct.
 * `result === null` (unplayed) games are excluded — same filter
 * `collectNflSamples` applies.
 *
 * No network, no I/O — `games` must already be fetched (see
 * `capturePredictions.ts`/the research page, both of which call
 * `fetchNflGames()` once and pass the result here), which is what makes this
 * exhaustively unit-testable with synthetic `NflGame[]` fixtures.
 */
export function buildNflEloAsOf(
  games: readonly NflGame[],
  asOfUtc: Date,
  opts: NflEloOpts = DEFAULT_NFL_ELO
): NflEloAsOfBook {
  const eligible = games
    .filter((g) => g.result !== null && g.date.getTime() < asOfUtc.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const elo = new NflElo(opts);
  const teamsSeen = new Set<string>();

  for (const g of eligible) {
    elo.touch(g.home, g.season);
    elo.touch(g.away, g.season);
    elo.update(g.home, g.away, g.result as number);
    teamsSeen.add(g.home);
    teamsSeen.add(g.away);
  }

  return { elo, teamsSeen, opts };
}
