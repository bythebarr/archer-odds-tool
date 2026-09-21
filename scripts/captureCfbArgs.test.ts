import { describe, it, expect } from "vitest";
import { parseArgs, redactConnectionStrings, safeErrorMessage, summarizeExclusions } from "./captureCfbArgs";

/**
 * Pure CLI-argument/output helpers for `capture-cfb-predictions.ts` (see
 * docs/architecture/CFB-V0.md's "Forward-prediction capture"). Added/
 * expanded by the adversarial review pass — the CLI script itself had zero
 * test coverage before this.
 */

const TODAY = "2026-09-21";

describe("parseArgs — defaults", () => {
  it("defaults to today (ET, injected) with no flags", () => {
    expect(parseArgs([], TODAY)).toEqual({ dateEt: TODAY, confirmRerun: false });
  });
});

describe("parseArgs — --date", () => {
  it("accepts an explicit future date", () => {
    expect(parseArgs(["--date=2026-09-27"], TODAY)).toEqual({ dateEt: "2026-09-27", confirmRerun: false });
  });

  it("accepts today's own date explicitly", () => {
    expect(parseArgs([`--date=${TODAY}`], TODAY).dateEt).toBe(TODAY);
  });

  it("rejects a past date", () => {
    expect(() => parseArgs(["--date=2020-01-01"], TODAY)).toThrow(/past/);
  });

  it("rejects a malformed date string", () => {
    expect(() => parseArgs(["--date=09/27/2026"], TODAY)).toThrow(/Invalid --date/);
  });

  it("rejects a real-shaped but invalid calendar date", () => {
    expect(() => parseArgs(["--date=2026-13-40"], TODAY)).toThrow(/Invalid --date/);
  });

  it("rejects a duplicate --date flag rather than silently using the last one", () => {
    expect(() => parseArgs(["--date=2026-09-27", "--date=2026-09-28"], TODAY)).toThrow(/Duplicate --date/);
  });
});

describe("parseArgs — --confirm-rerun", () => {
  it("sets confirmRerun and can be combined with --date in either order", () => {
    expect(parseArgs(["--confirm-rerun", "--date=2026-09-27"], TODAY)).toEqual({ dateEt: "2026-09-27", confirmRerun: true });
    expect(parseArgs(["--date=2026-09-27", "--confirm-rerun"], TODAY)).toEqual({ dateEt: "2026-09-27", confirmRerun: true });
  });

  it("repeating --confirm-rerun is harmless (a boolean flag, not an identity)", () => {
    expect(parseArgs(["--confirm-rerun", "--confirm-rerun"], TODAY).confirmRerun).toBe(true);
  });
});

describe("parseArgs — unknown/malformed arguments", () => {
  it("rejects an unrecognized flag", () => {
    expect(() => parseArgs(["--force"], TODAY)).toThrow(/Unrecognized argument/);
  });

  it("rejects a bare positional argument", () => {
    expect(() => parseArgs(["2026-09-27"], TODAY)).toThrow(/Unrecognized argument/);
  });

  it("rejects --date with no value cleanly (empty string, not a crash)", () => {
    expect(() => parseArgs(["--date="], TODAY)).toThrow(/Invalid --date/);
  });
});

describe("redactConnectionStrings", () => {
  it("redacts a postgres:// URL, including embedded credentials", () => {
    const msg = 'connection failed: postgresql://archer:hunter2@localhost:5432/archer_odds?schema=public timeout';
    const redacted = redactConnectionStrings(msg);
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("archer_odds");
    expect(redacted).toContain("postgres://[redacted]");
  });

  it("leaves a message with no connection string untouched", () => {
    expect(redactConnectionStrings("ESPN request failed: 503")).toBe("ESPN request failed: 503");
  });
});

describe("safeErrorMessage", () => {
  it("never includes DATABASE_URL's shape in the final message", () => {
    const err = new Error("P1001: Can't reach database server at postgresql://archer:hunter2@localhost:5432/archer_odds");
    const msg = safeErrorMessage(err);
    expect(msg).not.toContain("hunter2");
    expect(msg).not.toMatch(/postgres(?:ql)?:\/\/\w/);
  });

  it("also redacts an API-key-shaped query string (delegated to sanitizeErrorMessage)", () => {
    const err = new Error("fetch failed: https://example.com/api?apiKey=SECRET123");
    expect(safeErrorMessage(err)).not.toContain("SECRET123");
  });

  it("stringifies a non-Error thrown value rather than throwing itself", () => {
    expect(safeErrorMessage("a plain string failure")).toBe("a plain string failure");
  });
});

describe("summarizeExclusions", () => {
  it("counts exclusions by reason", () => {
    const out = summarizeExclusions([{ reason: "status:final" }, { reason: "status:final" }, { reason: "already-started" }]);
    expect(out).toContain("status:final: 2");
    expect(out).toContain("already-started: 1");
  });

  it("reports '(none)' for an empty exclusion list — a truthful zero, not a blank line", () => {
    expect(summarizeExclusions([])).toBe("  (none)");
  });
});
