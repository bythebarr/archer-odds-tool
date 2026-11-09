/**
 * NBA adapter — line shopping across books, graded off ESPN's free scoreboard.
 * Built on the shared team-league adapter (see teamLeague.ts), the same pipeline
 * as NFL; docs/architecture/nba-adapter.md has the plan and what's left.
 *
 * What prices NBA games is the points-ratings game model (queries/gameModel),
 * and its verdict is published: backtest:games writes its walk-forward
 * moneyline grade under the "nba" sport key (Phase 5, uniform with the NFL's
 * Decision 8 card), so the trust gate and /models grade the pricing model.
 */
import { NBA_LEAGUE } from "@/lib/nba/league";
import { createTeamLeagueAdapter } from "./teamLeague";

export const nbaAdapter = createTeamLeagueAdapter(NBA_LEAGUE);
