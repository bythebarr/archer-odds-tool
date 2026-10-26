import { handleTeamLeagueOddsPoll } from "@/lib/teamLeague/cronHandlers";
import { NBA_LEAGUE } from "@/lib/nba/league";
import { runNbaExtraMarketsPoll, runNbaPropsPoll } from "@/lib/nba/cronJobs";

/**
 * NBA lines move all day — injury reports and rest decisions land hours before
 * tip — so this polls through the afternoon and evening rather than NFL's twice a
 * day: five ticks in vercel.json, 6 credits each, the last at 8pm ET. The floor
 * sits under the tightest gap between those ticks (60 min), so every scheduled
 * tick fires while a stray manual re-run is still throttled.
 */
const MIN_INTERVAL_MINUTES = 50;

/** GET: Vercel Cron (always invokes via GET). POST: manual/GH Actions dispatch. Same handler either way. */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  // Player props and the extra game markets (alternates, team totals, halves, quarters) ride the same tick.
  return handleTeamLeagueOddsPoll(request, NBA_LEAGUE, MIN_INTERVAL_MINUTES, async () => {
    // Each half fails on its own: a props error never costs the extra markets, or the reverse.
    const settle = (p: Promise<unknown>) => p.catch((error: unknown) => ({ status: "error", error: String(error).slice(0, 200) }));
    return { props: await settle(runNbaPropsPoll()), markets: await settle(runNbaExtraMarketsPoll()) };
  });
}
