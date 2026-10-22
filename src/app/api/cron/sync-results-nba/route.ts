import { handleTeamLeagueResultsSync } from "@/lib/teamLeague/cronHandlers";
import { NBA_LEAGUE } from "@/lib/nba/league";
import { runNbaGameLogSync } from "@/lib/nba/cronJobs";

/** GET: Vercel Cron (always invokes via GET). POST: manual/GH Actions dispatch. Same handler either way. */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  // Player game logs ride the same tick, off the same free ESPN scoreboard.
  return handleTeamLeagueResultsSync(request, NBA_LEAGUE, runNbaGameLogSync);
}
