import { checkCronAuth } from "@/lib/cronAuth";
import { recordPollLog } from "@/lib/pollingPolicy";
import { syncGameWeather } from "@/lib/mlb/syncWeather";
import { todayEt, shiftEtDate } from "@/lib/dateEt";
import { classifyFetchStore, ingestHttpStatus, pollLogStatus, summaryForCaughtError } from "@/lib/engine/ingestResult";

const JOB_NAME = "poll-weather";

/**
 * Free (Open-Meteo), refreshes forecasts for the next few days of scheduled
 * MLB games at open-air venues. A short forward window, not the full
 * sync-schedule window — Open-Meteo's forecast is only meaningfully
 * accurate a few days out, so there's no value fetching further ahead; this
 * cron re-runs a few times a day and naturally refines the forecast as each
 * game approaches.
 */
const FORECAST_WINDOW_DAYS = 4;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const today = todayEt();
  const endDate = shiftEtDate(today, FORECAST_WINDOW_DAYS);

  try {
    const summary = await syncGameWeather(today, endDate);
    // Zero games considered is a legitimate empty result (e.g. off-season,
    // or every game in the window is at a non-open-roof venue); zero
    // upserted despite games considered is not (every forecast call failed
    // or returned nothing).
    const outcome = classifyFetchStore(
      { fetched: summary.gamesConsidered, stored: summary.weatherUpserted },
      { noun: "forecasts" }
    );
    await recordPollLog(JOB_NAME, pollLogStatus(outcome));
    return Response.json(
      { status: outcome.status, detail: outcome.detail, startDate: today, endDate, ...summary },
      { status: ingestHttpStatus(outcome.status) }
    );
  } catch (error) {
    const summary = summaryForCaughtError("mlb", error);
    await recordPollLog(JOB_NAME, pollLogStatus(summary));
    return Response.json(summary, { status: ingestHttpStatus(summary.status) });
  }
}
