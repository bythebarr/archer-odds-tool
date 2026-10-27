import { checkCronAuth } from "@/lib/cronAuth";
import { pollAllSports } from "@/lib/allSports/poll";
import { activeFeeds } from "@/lib/allSports/feeds";

/** Each call does whatever is due (catalog, schedules, odds by cadence, results) — safe to call as often as every few minutes. */
export const maxDuration = 60;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const feeds = activeFeeds();
  if (feeds.length === 0) {
    return Response.json({ polled: false, detail: "no odds feed key set (ODDS_API_KEY, PARLAY_API_KEY or ODDS_API_IO_KEY)" });
  }
  try {
    const summary = await pollAllSports({ feeds, maxMs: 50_000 });
    return Response.json({ polled: true, ...summary }, { status: summary.failures.length && !summary.leaguesPolled.length ? 502 : 200 });
  } catch (error) {
    return Response.json({ polled: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
