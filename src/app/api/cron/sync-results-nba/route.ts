import { handleTeamLeagueResultsSync } from "@/lib/teamLeague/cronHandlers";
import { NBA_LEAGUE } from "@/lib/nba/league";

/** GET: Vercel Cron (always invokes via GET). POST: manual/GH Actions dispatch. Same handler either way. */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  return handleTeamLeagueResultsSync(request, NBA_LEAGUE);
}
