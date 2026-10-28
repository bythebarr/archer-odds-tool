import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { syncEspnTennisFixtures } from "@/lib/tennis/espnFixtures";

/** Every ATP/WTA main-draw singles match for today and tomorrow from ESPN, free — tennis boards and props without an odds feed. */
export const maxDuration = 60;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const out = await syncEspnTennisFixtures();
  await recordPollLog("tennis-fixtures", `ok: ${JSON.stringify(out)}`);
  return Response.json(out);
}
