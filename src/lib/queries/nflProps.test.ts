import { describe, expect, it } from "vitest";
import { inferNflPosition } from "./nflProps";

const log = (passAttempts: number, rushAttempts: number, targets: number, receptions = targets) => ({ passAttempts, rushAttempts, targets, receptions });

describe("inferNflPosition", () => {
  it("reads a role from usage when the roster has no position", () => {
    expect(inferNflPosition([log(34, 3, 0), log(29, 5, 0)])).toBe("QB");
    expect(inferNflPosition([log(0, 18, 3), log(0, 14, 2)])).toBe("RB");
    expect(inferNflPosition([log(0, 1, 9, 6), log(0, 0, 7, 5)])).toBe("WR");
    expect(inferNflPosition([log(0, 0, 0), log(0, 0, 0)])).toBeNull();
    expect(inferNflPosition([])).toBeNull();
  });
});

describe("nflDefenseTableFromSums", () => {
  it("credits each team's production to the opponent's allowed row", async () => {
    const { nflDefenseTableFromSums } = await import("./nflProps");
    const abbr = new Map([
      ["a", "AAA"],
      ["b", "BBB"],
    ]);
    const sums = [
      { season: 2026, gameId: "g1", teamId: "a", position: "WR", _sum: { recYards: 200 } },
      { season: 2026, gameId: "g1", teamId: "b", position: "QB", _sum: { passYards: 300 } },
    ];
    const table = nflDefenseTableFromSums(sums, abbr, 2026);
    expect(table.teams["BBB"]!.games).toBe(1);
    expect(table.teams["BBB"]!.byPosition["WR"]!.allowed.recYards).toBe(200);
    expect(table.teams["AAA"]!.byPosition["QB"]!.allowed.passYards).toBe(300);
    // A team's own production never lands on its own row.
    expect(table.teams["AAA"]!.byPosition["WR"]!.allowed.recYards).toBe(0);
  });
});
