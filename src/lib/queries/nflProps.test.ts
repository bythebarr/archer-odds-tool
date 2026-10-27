import { describe, expect, it } from "vitest";
import { inferNflPosition } from "./nflProps";

const log = (passAttempts: number, rushAttempts: number, targets: number, receptions = targets) => ({ passAttempts, rushAttempts, targets, receptions });

describe("inferNflPosition", () => {
  it("reads a role from usage when the roster has no position", () => {
    expect(inferNflPosition([log(34, 3, 0), log(29, 5, 0)])).toBe("QB");
    expect(inferNflPosition([log(0, 18, 3), log(0, 14, 2)])).toBe("RB");
    expect(inferNflPosition([log(0, 1, 9, 6), log(0, 0, 7, 5)])).toBe("WR");
    expect(inferNflPosition([log(0, 0, 0), log(0, 0, 0)])).toBeNull();
    expect(inferNflPosition([])).toBeNull();
  });
});
