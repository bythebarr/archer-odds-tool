import { handleTeamLeagueResultsSync } from "@/lib/teamLeague/cronHandlers";
import { NFL_LEAGUE } from "@/lib/nfl/league";

/** GET: Vercel Cron (always invokes via GET). POST: manual/GH Actions dispatch. Same handler either way. */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  return handleTeamLeagueResultsSync(request, NFL_LEAGUE);
}
