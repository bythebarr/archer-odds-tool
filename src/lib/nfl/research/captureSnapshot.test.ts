import { describe, it, expect } from "vitest";
import { shouldBlockRerun } from "./captureSnapshot";

/**
 * The retry/idempotency decision, isolated as a pure predicate (see
 * captureSnapshot.ts's own docstring — this mirrors CFB's identical
 * `shouldBlockRerun` deliberately). `captureNflResearchSnapshot` itself does
 * real I/O (Prisma + ESPN + nflverse) and is not covered by a DB-mocked
 * test, matching this codebase's convention of testing only pure functions.
 */

const EXISTING = { id: "run-1", generatedAt: new Date("2026-09-21T20:00:00.000Z") };

describe("shouldBlockRerun", () => {
  it("does not block when no run exists yet", () => {
    expect(shouldBlockRerun(null, false)).toBe(false);
  });

  it("blocks when a run already exists and confirmRerun was not passed", () => {
    expect(shouldBlockRerun(EXISTING, false)).toBe(true);
  });

  it("does not block when a run already exists but confirmRerun was explicitly passed", () => {
    expect(shouldBlockRerun(EXISTING, true)).toBe(false);
  });

  it("does not block when no run exists, even with confirmRerun set", () => {
    expect(shouldBlockRerun(null, true)).toBe(false);
  });
});
