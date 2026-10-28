/**
 * The cron route bodies for a team league's odds poll and results sync. Each
 * league's `/api/cron/*` route is a thin wrapper over these, so NFL and NBA share
 * one implementation of the throttling, logging, and failure reporting.
 */
import { checkCronAuth } from "@/lib/cronAuth";
import { prisma } from "@/lib/prisma";
import { decideFixedCadencePoll, recordPollLog, shouldPollNow, writeOutcomeStatus } from "@/lib/pollingPolicy";
import { classifyFetchStore, ingestHttpStatus, sanitizeErrorMessage } from "@/lib/engine/ingestResult";
import { pollAndStoreTeamLeagueOdds } from "./ingest";
import { syncAndGradeTeamLeagueResults } from "./results";
import { syncTeamLeagueSchedule } from "./schedule";
import { purgePreseason } from "./preseason";
import type { TeamLeague } from "./league";

/**
 * A league-specific job that rides an existing tick — NBA props ride the odds
 * poll, NBA game logs ride the results sync — so a new data feed doesn't need
 * its own cron entry. It runs after the main job succeeds, owns its own PollLog
 * row, and its outcome (or its error) lands in the response under `also`.
 */
export type RideAlongJob = () => Promise<unknown>;

async function runRideAlong(job: RideAlongJob | undefined): Promise<{ also?: unknown }> {
  if (!job) return {};
  try {
    return { also: await job() };
  } catch (error) {
    return { also: { status: "error", error: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)) } };
  }
}

/**
 * Refreshes the league's schedule from ESPN. Runs on every odds and results
 * tick, before the throttle and before any keyed provider, so the schedule
 * shows up even when odds can't be fetched. Never throws.
 */
async function refreshSchedule(league: TeamLeague): Promise<{ schedule: unknown; preseason?: unknown }> {
  try {
    const schedule = await syncTeamLeagueSchedule(league);
    // Preseason games stored before the scoreboard filter (or by a book that hung
    // them) are swept out every six hours; outside preseason months it costs nothing.
    const purgeJob = `preseason-purge-${league.sport}`;
    const last = await prisma.pollLog.findUnique({ where: { jobName: purgeJob } });
    // Not decideFixedCadencePoll: this is free (ESPN), so the odds-credit guard doesn't apply.
    if (shouldPollNow(last?.lastPolledAt ?? null, 360)) {
      // The first sweep reaches back four seasons; after that, the last 45 days.
      const preseason = await purgePreseason(league, last ? 45 : 1500);
      await recordPollLog(purgeJob, `ok: ${JSON.stringify(preseason)}`);
      return { schedule, preseason };
    }
    return { schedule };
  } catch (error) {
    return { schedule: { status: "error", error: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)) } };
  }
}

/**
 * Odds poll on the conservative fixed-cadence policy (tennis/soccer's), not MLB's
 * tiered near-first-pitch throttle. `minIntervalMinutes` is the floor between
 * polls; the cron schedule decides when ticks actually arrive.
 */
export async function handleTeamLeagueOddsPoll(
  request: Request,
  league: TeamLeague,
  minIntervalMinutes: number,
  afterPoll?: RideAlongJob
): Promise<Response> {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const schedule = await refreshSchedule(league);
  const jobName = league.oddsJobName;
  const decision = await decideFixedCadencePoll(jobName, minIntervalMinutes);

  if (!decision.shouldPoll) {
    return Response.json({ polled: false, ...decision, ...schedule });
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
    // After the game lines are stored, so a ride-along keyed on games sees them.
    const also = await runRideAlong(afterPoll);
    return Response.json(
      { polled: true, status: outcome.status, ...decision, ...summary, ...also, ...schedule },
      { status: ingestHttpStatus(outcome.status) }
    );
  } catch (error) {
    // Same rationale as the other polls: a transient provider failure shouldn't
    // crash the cron tick — log it so the next scheduled run can retry.
    const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
    await recordPollLog(jobName, `error: ${message}`);
    return Response.json({ polled: false, status: "error", ...decision, error: message, ...schedule }, { status: 502 });
  }
}

/**
 * Results sync. No credit guardrail, unlike the odds polls: ESPN's scoreboard is
 * free and unkeyed, so this is rate-limited only by its cron schedule. That's
 * also why it re-checks several days rather than just today — see LOOKBACK_DAYS.
 */
export async function handleTeamLeagueResultsSync(
  request: Request,
  league: TeamLeague,
  afterSync?: RideAlongJob
): Promise<Response> {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const jobName = `sync-results-${league.sport}`;
  const schedule = await refreshSchedule(league);
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
    const also = await runRideAlong(afterSync);
    return Response.json(
      { ok: outcome.status === "ok" || outcome.status === "empty", status: outcome.status, ...summary, ...also, ...schedule },
      { status: ingestHttpStatus(outcome.status) }
    );
  } catch (error) {
    const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
    await recordPollLog(jobName, `error: ${message}`);
    return Response.json({ ok: false, status: "error", error: message, ...schedule }, { status: 502 });
  }
}
