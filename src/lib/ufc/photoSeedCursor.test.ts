import { describe, it, expect } from "vitest";
import { parseSeedNextPage } from "./backfillUfc";

describe("parseSeedNextPage", () => {
  it("starts at page 1 when no cursor has been recorded yet", () => {
    expect(parseSeedNextPage(null)).toBe(1);
    expect(parseSeedNextPage(undefined)).toBe(1);
  });

  it("returns null once the seed is done (stops the seed)", () => {
    expect(parseSeedNextPage("done")).toBeNull();
  });

  it("resumes from the recorded next page", () => {
    expect(parseSeedNextPage("next=21")).toBe(21);
    expect(parseSeedNextPage("next=100")).toBe(100);
  });

  it("falls back to page 1 for an unrecognized status rather than skipping history", () => {
    expect(parseSeedNextPage("ok whatever")).toBe(1);
  });
});
