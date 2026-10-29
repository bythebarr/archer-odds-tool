import { describe, it, expect } from "vitest";
import { postedDates, withPostedDate } from "./postMarker";

/**
 * The recap checks yesterday and today on every run. With one date in the
 * marker, posting today's recap made yesterday read "not posted" and re-post.
 */
describe("posted-date marker", () => {
  it("remembers both dates once both have posted", () => {
    const v = withPostedDate(withPostedDate(null, "2026-10-27"), "2026-10-28");
    expect(postedDates(v)).toEqual(["2026-10-27", "2026-10-28"]);
  });

  it("reads a single date written before the change", () => {
    expect(postedDates("2026-10-27")).toEqual(["2026-10-27"]);
  });

  it("ignores anything that isn't a date", () => {
    expect(postedDates("ok")).toEqual([]);
    expect(postedDates(null)).toEqual([]);
  });

  it("doesn't repeat a date posted twice, and keeps the last week", () => {
    let v = "";
    for (let d = 1; d <= 9; d++) v = withPostedDate(v, `2026-10-0${d}`);
    v = withPostedDate(v, "2026-10-09");
    expect(postedDates(v)).toEqual(["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
  });
});
