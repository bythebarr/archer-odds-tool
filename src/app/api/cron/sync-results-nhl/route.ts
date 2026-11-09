import { handleTeamLeagueResultsSync } from "@/lib/teamLeague/cronHandlers";
import { NHL_LEAGUE } from "@/lib/nhl/league";

/** GET: Vercel Cron (always invokes via GET). POST: manual/GH Actions dispatch. Same handler either way. */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  // No game-log ride-along in v1: there is no NHL player pipeline to feed
  // yet. Schedule refresh + results grading ride inside the handler, same
  // as NBA/NFL.
  return handleTeamLeagueResultsSync(request, NHL_LEAGUE);
}
