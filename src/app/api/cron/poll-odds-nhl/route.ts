import { handleTeamLeagueOddsPoll } from "@/lib/teamLeague/cronHandlers";
import { NHL_LEAGUE } from "@/lib/nhl/league";

/**
 * Lines move through the day as starting goalies and injuries land: four
 * ticks in the ops schedule (14/18/22/0 UTC). The floor sits under the
 * tightest gap between those ticks (2h), so every scheduled tick fires while
 * a stray manual re-run stays throttled.
 */
const MIN_INTERVAL_MINUTES = 110;

/** GET: Vercel Cron (always invokes via GET). POST: manual/GH Actions dispatch. Same handler either way. */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  // No ride-alongs in v1: NHL has no props or extra-markets pipeline yet —
  // the extra-markets ride-along stays NBA/NFL until a modeled-props build
  // gives NHL markets something to attach to (see the Phase 5 backlog).
  return handleTeamLeagueOddsPoll(request, NHL_LEAGUE, MIN_INTERVAL_MINUTES);
}
