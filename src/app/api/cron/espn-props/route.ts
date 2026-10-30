import { checkCronAuth } from "@/lib/cronAuth";
import { pollEspnProps } from "@/lib/odds/espnPropsPoll";
import { recordPollLog } from "@/lib/pollingPolicy";

/**
 * Free player-prop lines from ESPN (DraftKings today, no key, no credits) for
 * every league that carries them, events in the next four days. NBA and NFL
 * props also land in their boards' typed tables. Safe to call as often as the
 * cron allows.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  try {
    const out = await pollEspnProps(Date.now() + 50_000);
    await recordPollLog("espn-props", `ok: ${JSON.stringify(out).slice(0, 400)}`);
    return Response.json(out);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : String(error);
    await recordPollLog("espn-props", `error: ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }
}
