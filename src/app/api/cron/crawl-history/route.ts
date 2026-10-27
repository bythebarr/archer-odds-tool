import { checkCronAuth } from "@/lib/cronAuth";
import { crawlHistory } from "@/lib/teamLeague/historyCrawl";

export const maxDuration = 60;

/**
 * Advances the automatic player-history backfill (see historyCrawl.ts): two
 * dates per league per call, so a call fits the 60s limit. On a frequent
 * schedule the full two-season history fills in within hours, with no manual
 * workflow run; once both leagues reach yesterday it's a no-op.
 */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const results = [];
  for (const sport of ["nba", "nfl"] as const) {
    try {
      results.push(await crawlHistory(sport, 2));
    } catch (error) {
      results.push({ sport, error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
    }
  }
  return Response.json({ results });
}
