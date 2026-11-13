import { describe, expect, it } from "vitest";
import { oddsFeedState, pricesFromLabel, scheduledGapMinutes, type PollRow } from "./oddsFeedState";

const now = new Date("2026-11-13T15:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const row = (jobName: string, h: number, lastStatus = "ok"): PollRow => ({ jobName, lastPolledAt: hoursAgo(h), lastStatus });

describe("oddsFeedState", () => {
  it("reads each job's longest scheduled gap", () => {
    expect(scheduledGapMinutes("poll-odds-nba")).toBe(14 * 60); // 0, 14, 18, 21, 23 UTC → 0→14 is the longest
    expect(scheduledGapMinutes("poll-odds-nfl")).toBe(13 * 60); // 10, 21
    expect(scheduledGapMinutes("nope")).toBeNull();
  });

  it("live when a paid odds job polled within its gap", () => {
    const s = oddsFeedState([row("poll-odds-nba", 3), row("poll-odds-nfl", 40)], now);
    expect(s.frozen).toBe(false);
    expect(s.pricesAsOf!.getTime()).toBe(hoursAgo(3).getTime());
  });

  it("frozen, dated by the newest real poll, once every paid job is past its gap", () => {
    const s = oddsFeedState([row("poll-odds-nba", 12 * 24), row("poll-odds-nfl", 13 * 24), row("espn-odds", 0.5)], now);
    expect(s.frozen).toBe(true);
    expect(pricesFromLabel(s.pricesAsOf!)).toBe("Nov 1");
  });

  it("frozen when the credits guardrail is blocking, however recent the last poll", () => {
    const s = oddsFeedState([row("poll-odds-nba", 1), row("credits-guardrail", 0.2, "blocked: low-credits (last known remaining 3)")], now);
    expect(s).toMatchObject({ frozen: true, reason: "odds quota is used up" });
  });

  it("frozen with no paid poll on record", () => {
    expect(oddsFeedState([], now)).toMatchObject({ frozen: true, pricesAsOf: null });
  });
});
