import { describe, it, expect } from "vitest";
import { shouldBlockRerun, seasonForDate } from "./capturePredictions";

/**
 * The retry/idempotency decision (see docs/architecture/
 * MODEL-PREDICTION-LIFECYCLE.md and this module's own docstring for why
 * there is no DB-level idempotency key — this is a pure, unit-testable
 * predicate instead). `captureCfbPredictions` itself does real I/O (Prisma +
 * ESPN) and is not covered by a DB-mocked test, matching this codebase's
 * existing convention of testing only pure functions.
 */

const EXISTING = { id: "run-1", generatedAt: new Date("2026-09-27T12:00:00.000Z") };

describe("shouldBlockRerun", () => {
  it("does not block when no run exists yet for this date/model", () => {
    expect(shouldBlockRerun(null, false)).toBe(false);
  });

  it("blocks when a run already exists and confirmRerun was not passed", () => {
    expect(shouldBlockRerun(EXISTING, false)).toBe(true);
  });

  it("does not block when a run already exists but confirmRerun was explicitly passed — legitimate revisions are never weakened", () => {
    expect(shouldBlockRerun(EXISTING, true)).toBe(false);
  });

  it("does not block when no run exists, even with confirmRerun set (a no-op flag in that case)", () => {
    expect(shouldBlockRerun(null, true)).toBe(false);
  });
});

/**
 * January bowl-season games belong to the PRIOR fall's season (e.g. a
 * January 2027 CFP final is part of the "2026" season) — mirrors
 * `src/app/cfb/page.tsx`'s own identical private helper (duplicated, not
 * imported, per this module's docstring on why).
 */
describe("seasonForDate", () => {
  it("maps a January date to the prior calendar year's season", () => {
    expect(seasonForDate("2027-01-12")).toBe(2026);
  });

  it("maps a September date to its own calendar year's season", () => {
    expect(seasonForDate("2026-09-26")).toBe(2026);
  });

  it("maps a December date to its own calendar year's season (regular season still in progress)", () => {
    expect(seasonForDate("2026-12-05")).toBe(2026);
  });

  it("maps the December/January boundary correctly on both sides", () => {
    expect(seasonForDate("2026-12-31")).toBe(2026);
    expect(seasonForDate("2027-01-01")).toBe(2026);
  });
});
