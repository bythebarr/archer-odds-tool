import { prisma } from "@/lib/prisma";
import { checkCronAuth } from "@/lib/cronAuth";
import { NBA_LEAGUE } from "@/lib/nba/league";
import { NFL_LEAGUE } from "@/lib/nfl/league";
import { pollEspnOddsMlb, pollEspnOddsTeamLeague, storeScoreboardOddsForLeague, storeSoccerPickcenterOdds } from "@/lib/odds/espnOddsPoll";
import { recordPollLog } from "@/lib/pollingPolicy";

/**
 * Free book prices from ESPN (no key, no credits): NBA, NFL and MLB games, every
 * US-style ESPN league in the all-sports engine, then soccer match by match
 * until the time runs out. Safe to call as often as the cron allows.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const started = Date.now();
  const deadline = started + 50_000;
  const out: Record<string, unknown> = {};
  const safe = async (key: string, f: () => Promise<unknown>) => {
    if (Date.now() > deadline) return;
    try {
      out[key] = await f();
    } catch (error) {
      out[key] = { error: error instanceof Error ? error.message.slice(0, 160) : String(error) };
    }
  };
  await safe("nba", () => pollEspnOddsTeamLeague(NBA_LEAGUE, 2));
  await safe("nfl", () => pollEspnOddsTeamLeague(NFL_LEAGUE, 7));
  await safe("mlb", () => pollEspnOddsMlb(3));
  const leagues = await prisma.league.findMany({ where: { active: true, espnPath: { not: null }, NOT: { sport: "soccer" }, upcomingCount: { gt: 0 } }, select: { espnPath: true } });
  let others = 0;
  for (const l of leagues) {
    if (Date.now() > deadline - 15_000) break;
    await safe(`league:${l.espnPath}`, async () => {
      others += await storeScoreboardOddsForLeague(l.espnPath!, 3);
    });
  }
  out.otherLeagueLines = others;
  await safe("soccer", () => storeSoccerPickcenterOdds(60, 120, deadline));
  await recordPollLog("espn-odds", `ok: ${JSON.stringify(out).slice(0, 400)}`);
  return Response.json(out);
}
