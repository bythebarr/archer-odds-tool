import { checkCronAuth } from "@/lib/cronAuth";
import { syncRosters } from "@/lib/rosters/espnRosters";
import { recordPollLog } from "@/lib/pollingPolicy";

/** NBA and NFL rosters from ESPN (free): traded and signed players move to their new team before they play for it. */
export const maxDuration = 60;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const out = await Promise.all((["nba", "nfl"] as const).map((sport) => syncRosters(sport)));
  await recordPollLog("sync-rosters", `ok: ${JSON.stringify(out).slice(0, 400)}`);
  return Response.json({ out });
}
