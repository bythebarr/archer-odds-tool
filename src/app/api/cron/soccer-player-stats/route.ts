import { checkCronAuth } from "@/lib/cronAuth";
import { ingestSoccerPlayerStats, warmSoccerPhotos } from "@/lib/soccer/playerStats";
import { recordPollLog } from "@/lib/pollingPolicy";

/**
 * Soccer player box scores from ESPN (free): finished matches not yet read,
 * newest first, for about 40 seconds, then a few players' photos. Several times a day keeps up with every
 * league; the "All sports — fill" workflow loops it for the first backfill.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const started = Date.now();
  const stats = await ingestSoccerPlayerStats({ deadline: started + 42_000 });
  const photos = await warmSoccerPhotos(started + 52_000).catch(() => 0);
  const out = { ...stats, photos };
  await recordPollLog("soccer-player-stats", `ok: ${JSON.stringify(out)}`);
  return Response.json(out);
}
