import { describe, expect, it } from "vitest";
import { parseWinningSide } from "./grading";

describe("parseWinningSide", () => {
  it("picks the side with more sets won under the assumed 'sets won' integer-string shape", () => {
    const winner = parseWinningSide(
      [
        { name: "Player A", score: "3" },
        { name: "Player B", score: "1" },
      ],
      "Player A",
      "Player B"
    );
    expect(winner).toBe("home");
  });

  it("picks away when the away competitor has more sets", () => {
    const winner = parseWinningSide(
      [
        { name: "Player A", score: "1" },
        { name: "Player B", score: "3" },
      ],
      "Player A",
      "Player B"
    );
    expect(winner).toBe("away");
  });

  it("returns null (skip grading) for a full set-by-set score string instead of misparsing it", () => {
    // If The Odds API's actual shape turns out to be a set-by-set string
    // rather than a plain sets-won count, this must NOT silently produce a
    // wrong winner via a lenient parse like parseInt.
    const winner = parseWinningSide(
      [
        { name: "Player A", score: "6-4 6-3 6-2" },
        { name: "Player B", score: "4-6 3-6 2-6" },
      ],
      "Player A",
      "Player B"
    );
    expect(winner).toBeNull();
  });

  it("returns null when scores is null (match not actually complete)", () => {
    expect(parseWinningSide(null, "Player A", "Player B")).toBeNull();
  });

  it("returns null when a competitor name doesn't match either side", () => {
    const winner = parseWinningSide(
      [
        { name: "Someone Else", score: "3" },
        { name: "Player B", score: "1" },
      ],
      "Player A",
      "Player B"
    );
    expect(winner).toBeNull();
  });

  it("returns null on a tie (shouldn't happen in tennis, but never guess)", () => {
    const winner = parseWinningSide(
      [
        { name: "Player A", score: "2" },
        { name: "Player B", score: "2" },
      ],
      "Player A",
      "Player B"
    );
    expect(winner).toBeNull();
  });
});
