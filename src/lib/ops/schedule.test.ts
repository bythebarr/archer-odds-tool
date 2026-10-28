import { describe, expect, it } from "vitest";
import { JOBS, TICK_HOURS, dueJobs, tickRuns } from "./schedule";

const at = (h: number, m = 5) => new Date(Date.UTC(2026, 9, 28, h, m));

describe("tick schedule", () => {
  it("runs hourly by day, every 2 hours overnight, and thins when the budget runs low", () => {
    expect(tickRuns(at(13), null)).toBe(true);
    expect(tickRuns(at(7), null)).toBe(false);
    expect(tickRuns(at(13), 0.7)).toBe(false);
    expect(tickRuns(at(14), 0.7)).toBe(true);
  });

  it("runs cadence jobs when they're stale and fixed-hour jobs once in their hour", () => {
    const now = at(14);
    const due = dueJobs(now, (p) => (p === "espn-odds" ? now.getTime() - 20 * 60_000 : p === "post-discord" ? now.getTime() - 10 * 60_000 : undefined));
    const paths = due.map((j) => j.path);
    expect(paths).not.toContain("espn-odds");
    expect(paths).toContain("poll-all-sports");
    expect(paths).toContain("poll-odds-nba");
    expect(paths).not.toContain("post-discord");
    expect(paths).not.toContain("poll-odds-nfl");
  });

  it("every fixed hour is an hour the tick runs, so no job is stranded", () => {
    for (const j of JOBS) for (const h of j.hours ?? []) expect(TICK_HOURS).toContain(h);
  });
});
