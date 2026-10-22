/**
 * The cron route bodies for a team league's odds poll and results sync. Each
 * league's `/api/cron/*` route is a thin wrapper over these, so NFL and NBA share
 * one implementation of the throttling, logging, and failure reporting.
 */
import { checkCronAuth } from "@/lib/cronAuth";
import { decideFixedCadencePoll, recordPollLog, writeOutcomeStatus } from "@/lib/pollingPolicy";
import { classifyFetchStore, ingestHttpStatus, sanitizeErrorMessage } from "@/lib/engine/ingestResult";
import { pollAndStoreTeamLeagueOdds } from "./ingest";
import { syncAndGradeTeamLeagueResults } from "./results";
import type { TeamLeague } from "./league";

/**
 * Odds poll on the conservative fixed-cadence policy (tennis/soccer's), not MLB's
 * tiered near-first-pitch throttle. `minIntervalMinutes` is the floor between
 * polls; the cron schedule decides when ticks actually arrive.
 */
export async function handleTeamLeagueOddsPoll(
  request: Request,
  league: TeamLeague,
  minIntervalMinutes: number
): Promise<Response> {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const jobName = league.oddsJobName;
  const decision = await decideFixedCadencePoll(jobName, minIntervalMinutes);

  if (!decision.shouldPoll) {
    return Response.json({ polled: false, ...decision });
  }

  try {
    const summary = await pollAndStoreTeamLeagueOdds(league);
    // Events fetched but zero snapshots written is the failure these leagues are
    // most exposed to: every price flows through an exact team-name match, and
    // Parlay's names are known to drift. Say so in the log rather than a bare "ok".
    await recordPollLog(
      jobName,
      writeOutcomeStatus(summary.eventsFetched, summary.snapshotsWritten, "snapshots"),
      summary.creditsUsed,
      summary.creditsRemaining
    );
    const outcome = classifyFetchStore(
      { fetched: summary.eventsFetched, stored: summary.snapshotsWritten, rejected: summary.eventsSkippedUnknownTeam },
      { noun: "snapshots" }
    );
    return Response.json(
      { polled: true, status: outcome.status, ...decision, ...summary },
      { status: ingestHttpStatus(outcome.status) }
    );
  } catch (error) {
    // Same rationale as the other polls: a transient provider failure shouldn't
    // crash the cron tick — log it so the next scheduled run can retry.
    const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
    await recordPollLog(jobName, `error: ${message}`);
    return Response.json({ polled: false, status: "error", ...decision, error: message }, { status: 502 });
  }
}

/**
 * Results sync. No credit guardrail, unlike the odds polls: ESPN's scoreboard is
 * free and unkeyed, so this is rate-limited only by its cron schedule. That's
 * also why it re-checks several days rather than just today — see LOOKBACK_DAYS.
 */
export async function handleTeamLeagueResultsSync(request: Request, league: TeamLeague): Promise<Response> {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const jobName = `sync-results-${league.sport}`;
  try {
    const summary = await syncAndGradeTeamLeagueResults(league);
    // Completed results fetched but nothing graded means every one failed to
    // match a Game row — the exact silent failure mode that let tennis "succeed"
    // for weeks while grading nothing.
    await recordPollLog(jobName, writeOutcomeStatus(summary.resultsFetched, summary.gamesGraded, "games graded"));
    const outcome = classifyFetchStore(
      { fetched: summary.resultsFetched, stored: summary.gamesGraded },
      { noun: "games graded" }
    );
    return Response.json(
      { ok: outcome.status === "ok" || outcome.status === "empty", status: outcome.status, ...summary },
      { status: ingestHttpStatus(outcome.status) }
    );
  } catch (error) {
    const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
    await recordPollLog(jobName, `error: ${message}`);
    return Response.json({ ok: false, status: "error", error: message }, { status: 502 });
  }
}
