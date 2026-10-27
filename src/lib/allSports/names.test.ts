import { describe, expect, it } from "vitest";
import { bestMatch, nameSimilarity, teamKey } from "./names";

describe("team names", () => {
  it("strips filler and accents into one key", () => {
    expect(teamKey("AFC Bournemouth")).toBe("bournemouth");
    expect(teamKey("Bournemouth")).toBe("bournemouth");
    // Words that tell clubs apart stay: Atlético vs Real, City vs United.
    expect(teamKey("Atlético Madrid")).toBe("atletico madrid");
    expect(teamKey("Real Madrid CF")).toBe("real madrid");
    expect(teamKey("Fenerbahçe SK")).toBe("fenerbahce");
  });

  it("scores containment high and unrelated teams zero", () => {
    expect(nameSimilarity("Tottenham", "Tottenham Hotspur")).toBeGreaterThan(0.8);
    expect(nameSimilarity("Arsenal", "Chelsea")).toBe(0);
  });

  it("picks the right team and refuses ambiguous ones", () => {
    const espn = ["Manchester City", "Manchester United", "Newcastle United", "AFC Bournemouth"];
    expect(bestMatch("Bournemouth", espn)).toBe("AFC Bournemouth");
    expect(bestMatch("Newcastle", espn)).toBe("Newcastle United");
    // "Manchester" alone matches City and United equally: no guess.
    expect(bestMatch("Manchester", espn)).toBeNull();
  });
});
