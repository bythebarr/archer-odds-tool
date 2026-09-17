import { describe, it, expect } from "vitest";
import {
  buildIngestSummary,
  classifyFetchStore,
  classifyUfcIngest,
  ingestHttpStatus,
  isConfigError,
  isFreshStatus,
  pollLogStatus,
  sanitizeErrorMessage,
  summaryForCaughtError,
} from "./ingestResult";

/**
 * The Step 2 truthful-ingestion contract: one vocabulary (ok/empty/skipped/
 * unusable/error) every adapter and cron route reports through, so "ok"
 * always means the same thing. See docs/architecture/EDGE-BASELINE-AUDIT.md's
 * "Step 2 remediation" section for the full write-up.
 */
describe("classifyFetchStore", () => {
  it("reports ok when usable records were fetched and stored", () => {
    const { status, detail } = classifyFetchStore({ fetched: 12, stored: 12 }, { noun: "games" });
    expect(status).toBe("ok");
    expect(detail).toContain("12");
  });

  it("reports empty for a legitimate zero-event slate, not a failure", () => {
    const { status } = classifyFetchStore({ fetched: 0, stored: 0 }, { noun: "matches" });
    expect(status).toBe("empty");
  });

  it("does NOT treat a provider returning events with zero stored as an ordinary success", () => {
    // The exact case a bare `ok: true` used to hide: NFL/tennis/soccer's team
    // or player-name matching can fail for every event in a poll.
    const { status, detail } = classifyFetchStore({ fetched: 8, stored: 0 }, { noun: "games" });
    expect(status).toBe("unusable");
    expect(detail).toContain("8");
  });

  it("includes a rejected count in the success detail when supplied", () => {
    const { detail } = classifyFetchStore({ fetched: 10, stored: 7, rejected: 3 }, { noun: "games" });
    expect(detail).toContain("3 rejected");
  });

  it("supports a custom empty-detail message (e.g. 'no active tournament')", () => {
    const { status, detail } = classifyFetchStore(
      { fetched: 0, stored: 0 },
      { emptyDetail: "no allowlisted tournament active this cycle" }
    );
    expect(status).toBe("empty");
    expect(detail).toBe("no allowlisted tournament active this cycle");
  });
});

describe("summaryForCaughtError", () => {
  it("classifies missing/disabled provider configuration as skipped, not error", () => {
    const summary = summaryForCaughtError("mlb", new Error("PARLAY_API_KEY is not set"));
    expect(summary.status).toBe("skipped");
    expect(summary.ok).toBe(false);
    expect(summary.detail).toContain("PARLAY_API_KEY is not set");
  });

  it("classifies any other thrown error as a genuine failure", () => {
    const summary = summaryForCaughtError("nfl", new Error("The Odds API request failed: 500 Internal Server Error"));
    expect(summary.status).toBe("error");
    expect(summary.ok).toBe(false);
  });

  it("handles a non-Error throw without crashing", () => {
    const summary = summaryForCaughtError("soccer", "some string throw");
    expect(summary.status).toBe("error");
    expect(summary.detail).toBe("some string throw");
  });

  it("never lets a credential leak through in the summary detail", () => {
    const summary = summaryForCaughtError(
      "ufc",
      new Error("Cito API request failed: 401 — see https://api.citoapi.com/v1/events?apiKey=sk_live_abc123&x=1")
    );
    expect(summary.detail).not.toContain("sk_live_abc123");
    expect(summary.detail).toContain("[redacted]");
  });
});

describe("sanitizeErrorMessage", () => {
  it("redacts apiKey/token/key query-string values", () => {
    const out = sanitizeErrorMessage("failed: https://example.com/odds?apiKey=SECRET123&region=us&token=alsoSecret");
    expect(out).not.toContain("SECRET123");
    expect(out).not.toContain("alsoSecret");
    expect(out).toContain("[redacted]");
  });

  it("caps message length", () => {
    const out = sanitizeErrorMessage("x".repeat(1000), 50);
    expect(out.length).toBeLessThanOrEqual(51); // 50 chars + the ellipsis char
  });

  it("leaves an ordinary message untouched", () => {
    expect(sanitizeErrorMessage("The Odds API request failed: 429 Too Many Requests")).toBe(
      "The Odds API request failed: 429 Too Many Requests"
    );
  });

  it("redacts an 'Authorization: Bearer <token>' header echoed into a message", () => {
    const out = sanitizeErrorMessage("upstream 401: Authorization: Bearer sk_live_abcDEF123 was rejected");
    expect(out).not.toContain("sk_live_abcDEF123");
    expect(out).toContain("[redacted]");
  });

  it("redacts a bare 'Bearer <token>' with no Authorization label", () => {
    const out = sanitizeErrorMessage("request failed, sent Bearer sk_live_abcDEF123 to a dead host");
    expect(out).not.toContain("sk_live_abcDEF123");
  });
});

describe("isConfigError", () => {
  it("matches this codebase's own '<VAR>_API_KEY is not set' throws", () => {
    expect(isConfigError("ODDS_API_KEY is not set")).toBe(true);
    expect(isConfigError("CITO_API_KEY is not set")).toBe(true);
  });

  it("does not match an unrelated error", () => {
    expect(isConfigError("The Odds API request failed: 401 Unauthorized")).toBe(false);
  });
});

describe("buildIngestSummary / isFreshStatus", () => {
  it("derives ok=true for ok and empty, ok=false for skipped/unusable/error", () => {
    expect(buildIngestSummary("mlb", "ok", "d").ok).toBe(true);
    expect(buildIngestSummary("mlb", "empty", "d").ok).toBe(true);
    expect(buildIngestSummary("mlb", "skipped", "d").ok).toBe(false);
    expect(buildIngestSummary("mlb", "unusable", "d").ok).toBe(false);
    expect(buildIngestSummary("mlb", "error", "d").ok).toBe(false);
  });

  it("matches isFreshStatus for every status", () => {
    for (const status of ["ok", "empty", "skipped", "unusable", "error"] as const) {
      expect(buildIngestSummary("mlb", status, "d").ok).toBe(isFreshStatus(status));
    }
  });

  it("attaches counts only when provided, and spreads extra fields", () => {
    const withCounts = buildIngestSummary("nfl", "ok", "d", { fetched: 3, stored: 3 }, { creditsUsed: 6 });
    expect(withCounts.counts).toEqual({ fetched: 3, stored: 3 });
    expect(withCounts.creditsUsed).toBe(6);

    const withoutCounts = buildIngestSummary("f1", "empty", "d");
    expect(withoutCounts.counts).toBeUndefined();
  });
});

describe("ingestHttpStatus", () => {
  it("maps every status to its exact HTTP code (not just 'not 200')", () => {
    expect(ingestHttpStatus("ok")).toBe(200);
    expect(ingestHttpStatus("empty")).toBe(200);
    expect(ingestHttpStatus("skipped")).toBe(200);
    expect(ingestHttpStatus("unusable")).toBe(502);
    expect(ingestHttpStatus("error")).toBe(502);
  });
});

/**
 * Every cron route composes `classifyFetchStore`/`classifyUfcIngest` (success
 * path) or `summaryForCaughtError` (catch block) with `ingestHttpStatus` to
 * decide its actual HTTP response — this is that composition, exercised the
 * same way the routes exercise it, not just each half in isolation.
 */
describe("route-level HTTP composition", () => {
  it("a thrown provider error can never compose to HTTP 200", () => {
    const summary = summaryForCaughtError("nfl", new Error("The Odds API request failed: 500"));
    expect(ingestHttpStatus(summary.status)).toBe(502);
    expect(summary.ok).toBe(false);
  });

  it("a legitimate empty slate composes to a non-error HTTP response", () => {
    const outcome = classifyFetchStore({ fetched: 0, stored: 0 }, { noun: "matches" });
    expect(ingestHttpStatus(outcome.status)).toBe(200);
  });

  it("a provider responding with zero usable records composes to a non-2xx response", () => {
    const outcome = classifyFetchStore({ fetched: 5, stored: 0 }, { noun: "games" });
    expect(ingestHttpStatus(outcome.status)).toBe(502);
  });

  it("a skipped/disabled run composes to a non-error HTTP response, distinct from empty", () => {
    const summary = summaryForCaughtError("mlb", new Error("PARLAY_API_KEY is not set"));
    expect(summary.status).toBe("skipped");
    expect(ingestHttpStatus(summary.status)).toBe(200);
  });
});

describe("classifyUfcIngest", () => {
  it("reports ok when bouts were actually stored", () => {
    const { status } = classifyUfcIngest({ eventsProcessed: 2, boutsProcessed: 10, rejected: 0 });
    expect(status).toBe("ok");
  });

  it("reports empty when there's nothing new this cycle (the normal case most ticks)", () => {
    const { status } = classifyUfcIngest({ eventsProcessed: 0, boutsProcessed: 0, rejected: 0 });
    expect(status).toBe("empty");
  });

  it("does NOT report unusable for an event with no bouts announced yet (no rejection evidence)", () => {
    // Regression case: an event's `eventsProcessed` counter increments before
    // its bouts are even looked at (see backfillUfc.ts's ingestEvent), so
    // "events > 0, bouts stored === 0" alone is the ordinary shape of a
    // newly-created event whose card isn't posted yet — not a failure. Only
    // classifyFetchStore's generic fetched/stored rule would wrongly flag
    // this; classifyUfcIngest must not.
    const { status } = classifyUfcIngest({ eventsProcessed: 2, boutsProcessed: 0, rejected: 0 });
    expect(status).toBe("ok");
  });

  it("reports unusable only when bout data actually existed and was rejected", () => {
    const { status, detail } = classifyUfcIngest({ eventsProcessed: 1, boutsProcessed: 0, rejected: 3 });
    expect(status).toBe("unusable");
    expect(detail).toContain("3");
  });
});

describe("pollLogStatus", () => {
  it("keeps the 'error:' prefix for both unusable and error (status greps rely on this)", () => {
    expect(pollLogStatus({ status: "unusable", detail: "d" }).startsWith("error:")).toBe(true);
    expect(pollLogStatus({ status: "error", detail: "d" }).startsWith("error:")).toBe(true);
  });

  it("never prefixes ok/empty/skipped with 'error:'", () => {
    expect(pollLogStatus({ status: "ok", detail: "d" }).startsWith("error:")).toBe(false);
    expect(pollLogStatus({ status: "empty", detail: "d" }).startsWith("error:")).toBe(false);
    expect(pollLogStatus({ status: "skipped", detail: "d" }).startsWith("error:")).toBe(false);
  });

  it("labels skipped distinctly from a legitimate empty run", () => {
    expect(pollLogStatus({ status: "skipped", detail: "disabled" })).toBe("skipped: disabled");
    expect(pollLogStatus({ status: "empty", detail: "nothing to do" })).toBe("ok (empty: nothing to do)");
  });
});
