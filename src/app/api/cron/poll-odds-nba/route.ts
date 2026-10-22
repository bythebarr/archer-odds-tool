import { handleTeamLeagueOddsPoll } from "@/lib/teamLeague/cronHandlers";
import { NBA_LEAGUE } from "@/lib/nba/league";

/**
 * NBA lines move all day — injury reports and rest decisions land hours before
 * tip — so this polls through the afternoon and evening rather than NFL's twice a
 * day: five ticks in vercel.json, 6 credits each, the last one before West Coast
 * tip-offs. The floor sits under the tightest gap between those ticks (90 min),
 * so every scheduled tick fires while a stray manual re-run is still throttled.
 */
const MIN_INTERVAL_MINUTES = 75;

/** GET: Vercel Cron (always invokes via GET). POST: manual/GH Actions dispatch. Same handler either way. */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  return handleTeamLeagueOddsPoll(request, NBA_LEAGUE, MIN_INTERVAL_MINUTES);
}
