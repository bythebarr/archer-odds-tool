import { checkCronAuth } from "@/lib/cronAuth";
import { isValidEtDate, shiftEtDate, todayEt } from "@/lib/dateEt";
import { syncNflGameLogs, syncNflPositions } from "@/lib/nfl/gameLogs";

export const maxDuration = 60;

/** Days per call: a full NFL Sunday is ~13 box scores, so three days fit the 60s limit with room. */
const DEFAULT_DAYS = 3;
const MAX_DAYS = 7;

/**
 * One-time history backfill for NFL props: logs every completed game from
 * `from` forward, `days` ET dates per call, and answers with the `next` date to
 * call with (null once it reaches yesterday). Idempotent — games that already
 * have logs are skipped — so a rerun or an overlap costs nothing. Driven by the
 * "Backfill player history" workflow; not on the cron schedule, since the daily
 * results sync keeps the last four days current on its own. The last call also
 * fills positions from the rosters.
 *
 * POST /api/cron/backfill-nfl-game-logs?from=2025-09-04&days=3
 */
export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  if (!isValidEtDate(from)) return Response.json({ error: "from must be YYYY-MM-DD" }, { status: 400 });
  const days = Math.min(Math.max(Number(params.get("days")) || DEFAULT_DAYS, 1), MAX_DAYS);

  const yesterday = shiftEtDate(todayEt(), -1);
  const dates: string[] = [];
  for (let d = from; dates.length < days && d <= yesterday; d = shiftEtDate(d, 1)) dates.push(d);
  if (dates.length === 0) return Response.json({ dates, next: null });

  try {
    const summary = await syncNflGameLogs(dates);
    const after = shiftEtDate(dates[dates.length - 1], 1);
    const next = after <= yesterday ? after : null;
    const positions = next === null ? await syncNflPositions() : undefined;
    return Response.json({
      dates,
      next,
      gamesLogged: summary.gamesLogged,
      gamesCreated: summary.gamesCreated,
      playerLines: summary.playerLines,
      failures: summary.failures,
      positions,
    });
  } catch (error) {
    return Response.json(
      { dates, error: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }
}
