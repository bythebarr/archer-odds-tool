import { checkCronAuth } from "@/lib/cronAuth";
import { runDiagnosis } from "@/lib/queries/diagnosis";
import { recordPollLog } from "@/lib/pollingPolicy";

/**
 * Self-diagnosis, stage 1 (lib/tracking/diagnose): a daily pure read over
 * settled tracking data — calibration drift, projection bias, sample
 * progress to the 300 bar, CLV coverage, pipeline integrity, feed staleness,
 * guardrail-gauge sanity — persisted as DiagnosisFlag rows and surfaced on
 * the owner-only /models/edges page. Free: reads rows already written.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  try {
    const out = await runDiagnosis();
    await recordPollLog("diagnose-leans", `ok: ${JSON.stringify(out)}`);
    return Response.json(out);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : String(error);
    await recordPollLog("diagnose-leans", `error: ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }
}
