import { checkCronAuth } from "@/lib/cronAuth";
import { captureLeans } from "@/lib/tracking/capture";
import { recordPollLog } from "@/lib/pollingPolicy";

/**
 * Freezes ARCHR's leans for every NBA and NFL game starting in the next few
 * hours that hasn't been captured (lib/tracking/capture). Free: reads what the
 * pages already compute.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  try {
    const out = await captureLeans();
    const failed = Object.values(out).some((v) => "error" in v);
    await recordPollLog("capture-leans", `${failed ? "error" : "ok"}: ${JSON.stringify(out).slice(0, 400)}`);
    return Response.json(out, { status: failed ? 500 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : String(error);
    await recordPollLog("capture-leans", `error: ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }
}
