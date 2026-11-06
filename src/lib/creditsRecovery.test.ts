import { describe, expect, it } from "vitest";
import {
  CREDITS_PROBE_INTERVAL_MINUTES,
  blockedCreditsStatus,
  shouldProbeCredits,
} from "./creditsRecovery";

/**
 * Pure pieces of the credits-guardrail recovery (see pollingPolicy.ts's
 * resolveCreditsBlock for the DB/provider glue these gate). The behavior
 * being pinned: a blocked guardrail may spend exactly one probe credit a
 * day discovering a quota reset, and its blocked status line must say what
 * stale balance it rests on — the two things whose absence deadlocked
 * every keyed poll from Oct 27 to Nov 4, 2026 behind a silent HTTP 200.
 */

const NOW = new Date("2026-11-04T21:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe("shouldProbeCredits", () => {
  it("probes when it never has", () => {
    expect(shouldProbeCredits(null, NOW)).toBe(true);
  });

  it("does not probe twice inside the daily interval", () => {
    expect(shouldProbeCredits(hoursAgo(1), NOW)).toBe(false);
    expect(shouldProbeCredits(hoursAgo(23), NOW)).toBe(false);
  });

  it("probes again once a full day has passed", () => {
    expect(shouldProbeCredits(hoursAgo(24), NOW)).toBe(true);
    expect(shouldProbeCredits(hoursAgo(72), NOW)).toBe(true);
  });

  it("defaults to a 24h interval", () => {
    expect(CREDITS_PROBE_INTERVAL_MINUTES).toBe(24 * 60);
  });
});

describe("blockedCreditsStatus", () => {
  it("names the stale balance, when it was recorded, and the floor", () => {
    const status = blockedCreditsStatus(
      { remaining: 17, recordedAt: new Date("2026-11-01T10:45:00.000Z") },
      20
    );
    expect(status).toBe(
      "blocked: low-credits (last known remaining 17, recorded 2026-11-01T10:45:00.000Z; floor is 20)"
    );
  });

  it("says so when no balance has ever been recorded", () => {
    expect(blockedCreditsStatus(null, 20)).toBe("blocked: low-credits (no balance ever recorded)");
  });
});
