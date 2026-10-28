import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { importNflverseSeason } from "@/lib/nfl/nflverse";

/**
 * The advanced NFL line (snaps, air yards, EPA, red-zone and deep usage, team
 * neutral pass rate) from nflverse onto the ESPN game logs (lib/nfl/nflverse.ts).
 * Daily in season — nflverse refreshes the morning after games; `?season=2025` backfills.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const now = new Date();
  // The NFL season starts in September: January and February belong to last year's.
  const current = now.getUTCMonth() < 2 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const season = Number(new URL(request.url).searchParams.get("season")) || current;
  const out = await importNflverseSeason(season);
  await recordPollLog("nfl-advanced", `ok: ${JSON.stringify(out)}`);
  return Response.json(out);
}
