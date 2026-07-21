import { describe, it, expect } from "vitest";
import { writeOutcomeStatus } from "./pollingPolicy";

/**
 * The whole point of this helper is the middle case. Three separate outages
 * this codebase has hit — props dark for a day, a ledger wipe that 401'd, a
 * tennis grader that may never have graded anything — all looked identical from
 * /api/status: a green "ok" on a job that wrote nothing.
 */
describe("writeOutcomeStatus", () => {
  it("flags work that landed nothing as an error", () => {
    expect(writeOutcomeStatus(15, 0, "props")).toBe("error: considered 15 but wrote 0 props");
  });

  it("does NOT cry wolf when there was nothing to do", () => {
    // An off-season sport, or a day with no slate, legitimately writes zero.
    // Treating that as failure would leave soccer permanently red all winter
    // and train everyone to ignore the board.
    expect(writeOutcomeStatus(0, 0, "snapshots")).toBe("ok (nothing to do)");
  });

  it("reports the counts on success, so a partial run is still legible", () => {
    expect(writeOutcomeStatus(15, 4057, "props")).toBe("ok (4057 props from 15)");
  });

  it("treats a single write as success", () => {
    expect(writeOutcomeStatus(12, 1, "matches graded")).toBe("ok (1 matches graded from 12)");
  });

  it("prefixes errors with 'error:' so status greps catch them", () => {
    // /api/status is scanned for this prefix; the string shape is load-bearing.
    expect(writeOutcomeStatus(6, 0, "snapshots").startsWith("error:")).toBe(true);
    expect(writeOutcomeStatus(6, 3, "snapshots").startsWith("error:")).toBe(false);
  });
});
