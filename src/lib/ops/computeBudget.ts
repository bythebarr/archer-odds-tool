/**
 * The database compute budget, read from Neon's control-plane API: how many
 * compute-unit hours this billing period has used against a monthly budget.
 *
 * The site went down on 2026-10-14 because cron traffic quietly used up the
 * database plan's compute quota. The schedule now clusters jobs into shared wake
 * windows (vercel.json), and this guard is the backstop: past WARN_RATIO of the
 * budget, optional jobs (see OPTIONAL_JOBS) skip themselves, so the lineup
 * (NBA, NFL, UFC: odds, props, results, grading, Discord) keeps the remaining hours.
 *
 * Reading usage costs nothing against the budget: the API answers from Neon's
 * control plane without waking the database. It's opt-in (NEON_API_KEY +
 * NEON_PROJECT_ID) and fails open: with no key, or if Neon's API errors, every
 * job runs as before.
 */

const NEON_API = "https://console.neon.tech/api/v2";
/** Default monthly budget: ~$11 at $0.22/CU-hour. Override with COMPUTE_BUDGET_CU_HOURS. */
const DEFAULT_BUDGET_CU_HOURS = 50;
/** Optional jobs stop at this share of the budget, leaving the rest for the core product. */
export const WARN_RATIO = 0.8;

/** Jobs that pause when the budget runs low. Everything else always runs. */
export const OPTIONAL_JOBS = new Set([
  "backfill-player-game-logs",
  "backfill-f1",
  "poll-weather",
  "poll-odds-soccer",
  "poll-odds-tennis",
  "sync-results-tennis",
]);

export interface ComputeBudget {
  configured: boolean;
  usedCuHours: number | null;
  budgetCuHours: number;
  /** used / budget, or null when usage couldn't be read. */
  ratio: number | null;
  periodStart: string | null;
  error?: string;
}

interface NeonProjectResponse {
  project?: {
    /** Compute-unit seconds this billing period (compute size × active time). */
    compute_time_seconds?: number;
    consumption_period_start?: string;
  };
}

export async function getComputeBudget(): Promise<ComputeBudget> {
  const budgetCuHours = Number(process.env.COMPUTE_BUDGET_CU_HOURS) || DEFAULT_BUDGET_CU_HOURS;
  const key = process.env.NEON_API_KEY;
  const projectId = process.env.NEON_PROJECT_ID;
  const base = { budgetCuHours, usedCuHours: null, ratio: null, periodStart: null };
  if (!key || !projectId) return { ...base, configured: false };

  try {
    const res = await fetch(`${NEON_API}/projects/${encodeURIComponent(projectId)}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ...base, configured: true, error: `Neon API ${res.status}` };
    const body = (await res.json()) as NeonProjectResponse;
    const seconds = body.project?.compute_time_seconds;
    if (typeof seconds !== "number") return { ...base, configured: true, error: "no compute_time_seconds in Neon response" };
    const usedCuHours = seconds / 3600;
    return {
      configured: true,
      usedCuHours: Math.round(usedCuHours * 10) / 10,
      budgetCuHours,
      ratio: usedCuHours / budgetCuHours,
      periodStart: body.project?.consumption_period_start ?? null,
    };
  } catch (error) {
    return { ...base, configured: true, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * For an optional job: a 200 "skipped" Response when the budget is past
 * WARN_RATIO, else null (run as normal). A 200, not an error, because a skipped
 * optional job is the guard working.
 */
export async function skipIfOverBudget(jobName: string): Promise<Response | null> {
  if (!OPTIONAL_JOBS.has(jobName)) return null;
  const budget = await getComputeBudget();
  if (budget.ratio === null || budget.ratio < WARN_RATIO) return null;
  return Response.json({
    skipped: true,
    reason: `compute budget ${Math.round(budget.ratio * 100)}% used (${budget.usedCuHours}/${budget.budgetCuHours} CU-hours); optional job paused`,
  });
}
