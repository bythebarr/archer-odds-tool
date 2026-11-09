import { describe, it, expect } from "vitest";
import { unlockExitCode } from "./migrateUnlock";

describe("unlockExitCode", () => {
  it("is 0 once no session holds the lock", () => {
    expect(unlockExitCode(0)).toBe(0);
  });

  it("is 1 while any holder remains, so the workflow fails instead of reporting success on a still-locked state", () => {
    expect(unlockExitCode(1)).toBe(1);
    expect(unlockExitCode(3)).toBe(1);
  });
});
