import { checkCronAuth } from "@/lib/cronAuth";
import { syncInjuries } from "@/lib/injuries/espnInjuries";
import { recordPollLog } from "@/lib/pollingPolicy";

/**
 * ESPN's NBA and NFL injury reports (free), on their own: statuses move all
 * afternoon and right up to tip-off, and the props models, the game models and
 * the parlay tools all read them. Before, the reports only refreshed inside the
 * paid odds polls, a handful of times a day.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const out = await Promise.all(
    (["nba", "nfl"] as const).map((sport) => syncInjuries(sport).catch((error: unknown) => ({ sport, error: error instanceof Error ? error.message : String(error) })))
  );
  const failed = out.filter((o) => "error" in o);
  await recordPollLog("sync-injuries", `${failed.length === out.length ? "error" : "ok"}: ${JSON.stringify(out).slice(0, 400)}`);
  return Response.json({ out }, { status: failed.length === out.length ? 500 : 200 });
}
