import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { importTennisArchive } from "@/lib/tennis/archive";
import { dropDuplicateEspnTennisRows, importEspnTennisResults } from "@/lib/tennis/espnResults";
import { computeAndStoreTennisRatings } from "@/lib/tennis/ratings";

/**
 * Keeps tennis history current, free: this year's Sackmann archive (with each
 * match's serve line), ESPN's results since the archive's last date, then the
 * Elo ratings rebuilt over all of it. Daily; `?years=2015-2026` backfills.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const started = Date.now();
  const spec = new URL(request.url).searchParams.get("years");
  const year = new Date().getUTCFullYear();
  const [from, to] = spec && /^\d{4}-\d{4}$/.test(spec) ? spec.split("-").map(Number) : [year - 1, year];
  const years = Array.from({ length: to! - from! + 1 }, (_, i) => from! + i);
  const archive = await importTennisArchive({ years });
  const espn = await importEspnTennisResults({ maxDays: 45, deadline: started + 35_000 });
  const duplicatesDropped = await dropDuplicateEspnTennisRows();
  const ratings = await computeAndStoreTennisRatings();
  const out = { archiveInserted: archive.inserted, espn, duplicatesDropped, ratings };
  await recordPollLog("tennis-history", `ok: ${JSON.stringify(out)}`);
  return Response.json(out);
}
