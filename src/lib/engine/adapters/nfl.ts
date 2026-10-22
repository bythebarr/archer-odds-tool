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
 */
import { NFL_LEAGUE } from "@/lib/nfl/league";
import { createTeamLeagueAdapter } from "./teamLeague";

export const nflAdapter = createTeamLeagueAdapter(NFL_LEAGUE);
