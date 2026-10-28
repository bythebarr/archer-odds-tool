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

  it("grades MLB outcomes after the results sync, on its cadence", () => {
    const grade = JOBS.find((j) => j.path === "grade-outcomes");
    const sync = JOBS.find((j) => j.path === "sync-results");
    expect(grade).toMatchObject({ phase: 2, every: sync?.every });
    // Never run: due on the first tick, with the sync in phase 1 ahead of it.
    const due = dueJobs(at(13), () => undefined);
    expect(due.find((j) => j.path === "sync-results")?.phase ?? 1).toBe(1);
    expect(due.map((j) => j.path)).toContain("grade-outcomes");
    // Ran an hour ago: not due again until its cadence passes.
    expect(dueJobs(at(13), (p) => (p === "grade-outcomes" ? at(12).getTime() : undefined)).map((j) => j.path)).not.toContain("grade-outcomes");
  });
});
