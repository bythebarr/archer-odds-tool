import { checkCronAuth } from "@/lib/cronAuth";
import {
  postResultsRecap,
  gradePending,
  trackedSettleStates,
  yesterdayEt,
} from "@/lib/discord/postResults";
import { resultsTiming } from "@/lib/discord/schedule";
import { alreadyPosted, markPosted } from "@/lib/discord/postMarker";
import { todayEt } from "@/lib/dateEt";

/**
 * The results tick. Runs frequently and usually does nothing: it posts a date's
 * recap the moment that date's LAST tracked play settles, rather than on a
 * morning timer (see @/lib/discord/schedule).
 *
 * Two dates are considered, oldest first — yesterday (the common case: a card
 * finishing overnight) and today (an all-day-games slate that settles before
 * midnight). At most one recap posts per tick, so a backlog drains in order
 * instead of firing two posts into the channel at once.
 */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const attempts: Array<Record<string, unknown>> = [];

  try {
    for (const dateEt of [yesterdayEt(), todayEt()]) {
      if (await alreadyPosted("post-results", dateEt)) {
        attempts.push({ dateEt, skipped: "already-posted" });
        continue;
      }

      // Grade first — a play only becomes "settled" once the grader has run, so
      // checking before grading would hold every recap forever.
      const graded = await gradePending(dateEt);
      const timing = resultsTiming(await trackedSettleStates(dateEt), false);

      if (!timing.post) {
        attempts.push({ dateEt, skipped: timing.reason, pending: timing.pending, graded });
        continue;
      }

      const result = await postResultsRecap(dateEt);
      // Mark only on a real post, so wiring the webhook up later still recaps.
      if (result.posted) await markPosted("post-results", dateEt);
      return Response.json({ ...result, dateEt, graded, attempts });
    }

    return Response.json({ posted: false, attempts });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ posted: false, error: message, attempts }, { status: 502 });
  }
}
