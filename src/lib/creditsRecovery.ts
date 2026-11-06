/**
 * Pure pieces of the credits-guardrail recovery (the DB/provider glue lives
 * in pollingPolicy.ts, next to the guardrail itself). Kept import-free so
 * they're unit-testable under this repo's pure-functions-only convention.
 */

/**
 * The guardrail's own status row, and the recovery probe's. Both are ordinary
 * PollLog rows, which is deliberate: /api/status lists every row, so a blocked
 * guardrail and the probe's history are visible there with no new surface.
 */
export const CREDITS_GUARDRAIL_JOB = "credits-guardrail";
export const CREDITS_PROBE_JOB = "credits-probe";

/**
 * How often the recovery probe may run while the guardrail is blocking: once
 * a day. A monthly quota reset is discovered within a day of it happening,
 * and the probe's cost (1 credit — see pollingPolicy.ts) makes anything
 * faster pointless spend.
 */
export const CREDITS_PROBE_INTERVAL_MINUTES = 24 * 60;

/**
 * The probe's call target: the scores endpoint for this sport with no
 * `daysFrom` (live and upcoming only) is the cheapest keyed call the
 * provider bills — 1 credit — and its response headers carry the account's
 * true remaining balance.
 */
export const CREDITS_PROBE_SPORT_KEY = "basketball_nba";

/** Whether the recovery probe is due: never probed, or last probed at least `intervalMinutes` ago. */
export function shouldProbeCredits(
  lastProbeAt: Date | null,
  now: Date = new Date(),
  intervalMinutes: number = CREDITS_PROBE_INTERVAL_MINUTES
): boolean {
  if (!lastProbeAt) return true;
  return (now.getTime() - lastProbeAt.getTime()) / 60_000 >= intervalMinutes;
}

/** The status line a blocked job (and the guardrail row) wears. */
export function blockedCreditsStatus(
  snapshot: { remaining: number; recordedAt: Date } | null,
  floor: number
): string {
  if (!snapshot) return "blocked: low-credits (no balance ever recorded)";
  return `blocked: low-credits (last known remaining ${snapshot.remaining}, recorded ${snapshot.recordedAt.toISOString()}; floor is ${floor})`;
}
