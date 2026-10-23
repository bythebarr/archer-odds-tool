import { describe, it, expect, vi, afterEach } from "vitest";
import { getComputeBudget, skipIfOverBudget } from "./computeBudget";

function neon(computeSeconds: number | undefined, ok = true) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ project: { compute_time_seconds: computeSeconds, consumption_period_start: "2026-10-01T00:00:00Z" } }), {
      status: ok ? 200 : 500,
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("getComputeBudget", () => {
  it("is off and fetches nothing without Neon credentials", async () => {
    const fetchMock = neon(0);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEON_API_KEY", "");
    expect(await getComputeBudget()).toMatchObject({ configured: false, ratio: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("converts compute seconds to CU-hours against the budget", async () => {
    vi.stubEnv("NEON_API_KEY", "k");
    vi.stubEnv("NEON_PROJECT_ID", "p");
    vi.stubEnv("COMPUTE_BUDGET_CU_HOURS", "40");
    vi.stubGlobal("fetch", neon(30 * 3600));
    expect(await getComputeBudget()).toMatchObject({ configured: true, usedCuHours: 30, budgetCuHours: 40, ratio: 0.75 });
  });

  it("fails open when Neon's API errors", async () => {
    vi.stubEnv("NEON_API_KEY", "k");
    vi.stubEnv("NEON_PROJECT_ID", "p");
    vi.stubGlobal("fetch", neon(undefined, false));
    expect(await getComputeBudget()).toMatchObject({ configured: true, ratio: null, error: "Neon API 500" });
  });
});

describe("skipIfOverBudget", () => {
  it("pauses an optional job past 80% and never touches a core job", async () => {
    vi.stubEnv("NEON_API_KEY", "k");
    vi.stubEnv("NEON_PROJECT_ID", "p");
    vi.stubEnv("COMPUTE_BUDGET_CU_HOURS", "50");
    vi.stubGlobal("fetch", neon(45 * 3600));
    const skipped = await skipIfOverBudget("poll-weather");
    expect(skipped?.status).toBe(200);
    expect(await skipped!.json()).toMatchObject({ skipped: true });
    expect(await skipIfOverBudget("poll-odds-nba")).toBeNull();
  });

  it("lets optional jobs run under the threshold", async () => {
    vi.stubEnv("NEON_API_KEY", "k");
    vi.stubEnv("NEON_PROJECT_ID", "p");
    vi.stubGlobal("fetch", neon(10 * 3600));
    expect(await skipIfOverBudget("poll-weather")).toBeNull();
  });
});
