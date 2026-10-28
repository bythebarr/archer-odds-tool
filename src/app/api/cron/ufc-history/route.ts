import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { importUfcStatsArchive } from "@/lib/ufc/ufcStatsArchive";

/**
 * Every UFC fight with its round-by-round stats from the UFCStats archive,
 * linked into the Cito rows (lib/ufc/ufcStatsArchive.ts). Resumable: the first
 * runs walk the whole history ~40 events at a time; after that only new events.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const out = await importUfcStatsArchive({ deadline: Date.now() + 45_000 });
  await recordPollLog("ufc-history", `ok: ${JSON.stringify(out)}`);
  return Response.json(out);
}
