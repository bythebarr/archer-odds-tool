/**
 * NFL adapter — the feed and line shopping, not the model. Built on the shared
 * team-league adapter (see teamLeague.ts); docs/architecture/nfl-adapter.md has
 * the phasing.
 *
 * `src/lib/nfl/model.ts` already holds a validated-on-free-data Elo model. It is
 * deliberately NOT wired to `model` here: per the calibration work, a model only
 * prices real plays after a CLV backtest says it beats the closing line, and NFL's
 * hasn't been run on live prices. Wiring it early is exactly the mistake the
 * project has made before.
 *
 * What DOES price NFL games is the points-ratings game model
 * (queries/gameModel), and since Decision 8 its verdict is published:
 * backtest:games writes its walk-forward moneyline grade under the "nfl"
 * sport key, so the trust gate and /models grade the pricing model. The
 * Elo's baked calibration in nfl/model.ts is a reference snapshot only —
 * it is not, and must never become, the gate's NFL verdict.
 */
import { NFL_LEAGUE } from "@/lib/nfl/league";
import { createTeamLeagueAdapter } from "./teamLeague";

export const nflAdapter = createTeamLeagueAdapter(NFL_LEAGUE);
