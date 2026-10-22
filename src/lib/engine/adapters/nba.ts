/**
 * NBA adapter — line shopping across books, graded off ESPN's free scoreboard.
 * Built on the shared team-league adapter (see teamLeague.ts), the same pipeline
 * as NFL; docs/architecture/nba-adapter.md has the plan and what's left.
 */
import { NBA_LEAGUE } from "@/lib/nba/league";
import { createTeamLeagueAdapter } from "./teamLeague";

export const nbaAdapter = createTeamLeagueAdapter(NBA_LEAGUE);
