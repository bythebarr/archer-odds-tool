import { checkCronAuth } from "@/lib/cronAuth";
import { decideFixedCadencePoll, recordPollLog } from "@/lib/pollingPolicy";
import { pollAndStorePlayerProps } from "@/lib/props/pollPlayerProps";

const JOB_NAME = "poll-player-props";

/** GET: Vercel Cron (always invokes via GET). POST: manual/GH Actions dispatch. Same handler either way. */
export async function GET(request: Request) {
  return POST(request);
}

/**
 * LIVE as of the ParlayAPI switch. It was dormant because props cost ~4,350
 * credits/mo on The Odds API, which charged markets x regions PER GAME. Parlay
 * returns the whole sport's props in one 3-credit call, so a daily run is ~90
 * credits/mo — a ~48x cut that removed the only reason for the gate.
 *
 * `PLAYER_PROPS_ODDS_ENABLED="true"` is still required, so this stays a single
 * switch to pull if a future provider's pricing makes props expensive again.
 * Props are the edge that survived backtesting, so this is the one poll worth
 * paying for.
 */
export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  if (process.env.PLAYER_PROPS_ODDS_ENABLED !== "true") {
    return Response.json({ polled: false, reason: "disabled" });
  }

  // Once/day cadence dedup (23h floor, matching tennis's tolerance for a
  // manual trigger landing slightly early) — pollAndStorePlayerProps's own
  // per-game "already polled today" check is the primary guard; this is a
  // cheap extra check against a whole redundant run across the slate.
  const decision = await decideFixedCadencePoll(JOB_NAME, 23 * 60);
  if (!decision.shouldPoll) {
    return Response.json({ polled: false, ...decision });
  }

  try {
    const summary = await pollAndStorePlayerProps();
    await recordPollLog(JOB_NAME, "ok", summary.creditsUsed, summary.creditsRemaining);
    return Response.json({ polled: true, ...decision, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordPollLog(JOB_NAME, `error: ${message}`);
    return Response.json({ polled: false, ...decision, error: message }, { status: 502 });
  }
}
