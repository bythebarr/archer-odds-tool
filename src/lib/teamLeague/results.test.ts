import { describe, it, expect } from "vitest";
import { lookbackDatesEt } from "./results";

describe("lookbackDatesEt", () => {
  it("returns today first, then previous ET days", () => {
    // 2026-09-14T03:00Z is still Sunday the 13th in ET — a Sunday-night game
    // finishing after UTC midnight must still be looked up under its own ET day.
    expect(lookbackDatesEt(new Date("2026-09-14T03:00:00Z"), 3)).toEqual([
      "2026-09-13",
      "2026-09-12",
      "2026-09-11",
    ]);
  });

  it("crosses a month boundary correctly", () => {
    expect(lookbackDatesEt(new Date("2026-10-01T16:00:00Z"), 2)).toEqual(["2026-10-01", "2026-09-30"]);
  });
});
