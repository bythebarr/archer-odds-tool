import { handleTeamLeagueOddsPoll } from "@/lib/teamLeague/cronHandlers";
import { NFL_LEAGUE } from "@/lib/nfl/league";

/**
 * Conservative fixed cadence at 6 credits/call. Set in July, when NFL book depth
 * couldn't be judged until preseason (docs/architecture/provider-coverage.md);
 * revisit alongside a re-run of the coverage audit.
 */
const MIN_INTERVAL_MINUTES = 6 * 60;

/** GET: Vercel Cron (always invokes via GET). POST: manual/GH Actions dispatch. Same handler either way. */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  return handleTeamLeagueOddsPoll(request, NFL_LEAGUE, MIN_INTERVAL_MINUTES);
}
