import { describe, expect, it } from "vitest";
import { splitCsvLine } from "./nflverse";

describe("nflverse CSV", () => {
  it("splits quoted fields with commas and escaped quotes", () => {
    expect(splitCsvLine('a,"b, c",,"say ""hi""",5\r')).toEqual(["a", "b, c", "", 'say "hi"', "5"]);
  });
});
