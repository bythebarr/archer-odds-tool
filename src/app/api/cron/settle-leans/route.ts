import { checkCronAuth } from "@/lib/cronAuth";
import { settleLeans } from "@/lib/tracking/settle";
import { recordPollLog } from "@/lib/pollingPolicy";

/** Grades the captured leans whose games are final, with the closing line (lib/tracking/settle). Free. */
export const maxDuration = 60;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  try {
    const out = await settleLeans();
    await recordPollLog("settle-leans", `ok: ${JSON.stringify(out)}`);
    return Response.json(out);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : String(error);
    await recordPollLog("settle-leans", `error: ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }
}
